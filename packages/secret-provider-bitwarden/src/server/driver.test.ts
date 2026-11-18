import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as PlatformError from "effect/PlatformError";
import * as Redacted from "effect/Redacted";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import { BitwardenAccessTokenFile, BitwardenServerUrl } from "../shared/definition.ts";
import { driver } from "./driver.ts";

const encoder = new TextEncoder();
const SECRET_A = "bws://be8e0ad8-d545-4017-a55a-b02f014d4158";
const SECRET_B = "bws://0b4bc9c0-7f43-4fd5-8a5f-0e1b7f3c2a11";

type BwsResult = {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly hang?: boolean;
  readonly missing?: boolean;
};

interface Invocation {
  readonly args: ReadonlyArray<string>;
  readonly token: string | undefined;
}

function fakeBws(options: {
  readonly answer: (args: ReadonlyArray<string>) => BwsResult;
  readonly env?: Record<string, string>;
  readonly tokenFile?: string;
}) {
  const invocations: Array<Invocation> = [];
  const logs: Array<string> = [];
  const spawned = Deferred.makeUnsafe<void>();
  const layer = Layer.mergeAll(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        Effect.suspend(() => {
          const { args, options: spawnOptions } = command as unknown as {
            readonly args: ReadonlyArray<string>;
            readonly options: { readonly env?: Record<string, unknown> };
          };
          const token = spawnOptions.env?.BWS_ACCESS_TOKEN;
          invocations.push({
            args,
            token: Redacted.isRedacted(token) ? String(Redacted.value(token)) : undefined,
          });
          Deferred.doneUnsafe(spawned, Effect.void);
          const result = options.answer(args);
          if (result.missing) {
            return Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "ChildProcess",
                method: "spawn",
              }),
            );
          }
          return Effect.succeed(
            ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: result.hang
                ? Effect.never
                : Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.make(encoder.encode(result.stdout ?? "")),
              stderr: Stream.make(encoder.encode(result.stderr ?? "")),
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            }),
          );
        }),
      ),
    ),
    FileSystem.layerNoop({
      readFileString: (path) =>
        path === "/run/secrets/bws_access_token" && options.tokenFile !== undefined
          ? Effect.succeed(options.tokenFile)
          : Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
              }),
            ),
    }),
    NodeCrypto.layer,
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? {} })),
    Logger.layer([
      Logger.make(({ message }) => {
        logs.push(String(Array.isArray(message) ? message[0] : message));
      }),
    ]),
  );
  return { layer, invocations, logs, spawned };
}

const secretJson = (value: string) =>
  JSON.stringify({ object: "secret", id: "be8e0ad8", key: "OPENAI_API_KEY", value });

describe("Bitwarden driver", () => {
  it.effect("reads a secret's value with the token from the server's environment", () => {
    const bws = fakeBws({
      answer: () => ({ stdout: secretJson(" sk-live\n") }),
      env: { BWS_ACCESS_TOKEN: "0.env-token" },
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read({}, [SECRET_A]), [" sk-live\n"]);
      assert.deepStrictEqual(bws.invocations, [
        {
          args: [
            "--output",
            "json",
            "--color",
            "no",
            "secret",
            "get",
            "be8e0ad8-d545-4017-a55a-b02f014d4158",
          ],
          token: "0.env-token",
        },
      ]);
    }).pipe(Effect.provide(bws.layer));
  });

  it.effect("reads the token from a file and passes the server URL", () => {
    const bws = fakeBws({
      answer: () => ({ stdout: secretJson("sk-file") }),
      env: { BWS_ACCESS_TOKEN: "0.env-token" },
      tokenFile: "0.file-token\n",
    });
    return Effect.gen(function* () {
      const values = yield* driver.read(
        {
          accessTokenFile: BitwardenAccessTokenFile.make("/run/secrets/bws_access_token"),
          serverUrl: BitwardenServerUrl.make("https://vault.bitwarden.eu"),
        },
        [SECRET_A],
      );

      assert.deepStrictEqual(values, ["sk-file"]);
      assert.strictEqual(bws.invocations[0]?.token, "0.file-token");
      assert.isTrue(bws.invocations[0]?.args.includes("--server-url=https://vault.bitwarden.eu"));
    }).pipe(Effect.provide(bws.layer));
  });

  it.effect("reads nothing without a token", () => {
    const fromEnvironment = fakeBws({ answer: () => ({ stdout: secretJson("sk") }) });
    const fromFile = fakeBws({ answer: () => ({ stdout: secretJson("sk") }), tokenFile: " \n" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* driver.read({}, [SECRET_A]).pipe(Effect.provide(fromEnvironment.layer)),
        [undefined],
      );
      assert.deepStrictEqual(
        yield* driver
          .read(
            { accessTokenFile: BitwardenAccessTokenFile.make("/run/secrets/bws_access_token") },
            [SECRET_A],
          )
          .pipe(Effect.provide(fromFile.layer)),
        [undefined],
      );
      assert.deepStrictEqual(fromEnvironment.invocations, []);
      assert.deepStrictEqual(fromFile.invocations, []);
      assert.deepStrictEqual(fromEnvironment.logs, [
        "No Bitwarden access token: BWS_ACCESS_TOKEN is not set in the server's environment",
      ]);
      assert.deepStrictEqual(fromFile.logs, ["The Bitwarden access token file is empty"]);
    });
  });

  it.effect("names why a secret could not be read", () => {
    const cases: ReadonlyArray<[BwsResult, string]> = [
      [{ missing: true }, "The Bitwarden Secrets Manager CLI (bws) is not installed on the server"],
      [
        { code: 1, stderr: "Error:\n   0: Access token is not in a valid format" },
        "Bitwarden rejected the access token",
      ],
      [
        { code: 1, stderr: 'Error:\n   0: [400 Bad Request] {"error":"invalid_client"}' },
        "Bitwarden rejected the access token",
      ],
      [
        { code: 1, stderr: "Error:\n   0: [404 Not Found] Resource not found." },
        "Bitwarden secret not found, or the machine account cannot read it",
      ],
      [{ code: 0, stdout: "not json" }, "Bitwarden returned a secret in an unexpected format"],
    ];
    return Effect.forEach(cases, ([result, log]) => {
      const bws = fakeBws({ answer: () => result, env: { BWS_ACCESS_TOKEN: "0.env-token" } });
      return Effect.gen(function* () {
        assert.deepStrictEqual(yield* driver.read({}, [SECRET_A]), [undefined]);
        assert.deepStrictEqual(bws.logs, [log]);
      }).pipe(Effect.provide(bws.layer));
    });
  });

  it.effect("keeps other secrets when one is missing", () => {
    const bws = fakeBws({
      answer: (args) =>
        args.at(-1) === "be8e0ad8-d545-4017-a55a-b02f014d4158"
          ? { code: 1, stderr: "[404 Not Found] Resource not found." }
          : { stdout: secretJson("sk-b") },
      env: { BWS_ACCESS_TOKEN: "0.env-token" },
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read({}, [SECRET_A, SECRET_B]), [undefined, "sk-b"]);
    }).pipe(Effect.provide(bws.layer));
  });

  it.effect("stops reading when the token is rejected", () => {
    const bws = fakeBws({
      answer: (args) =>
        args.at(-1) === "be8e0ad8-d545-4017-a55a-b02f014d4158"
          ? { code: 1, stderr: '[400 Bad Request] {"error":"invalid_client"}' }
          : { hang: true },
      env: { BWS_ACCESS_TOKEN: "0.env-token" },
    });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* driver.read({}, [SECRET_A, SECRET_B]), [undefined, undefined]);
      assert.deepStrictEqual(bws.logs, ["Bitwarden rejected the access token"]);
    }).pipe(Effect.provide(bws.layer));
  });

  it.effect("gives up when bws does not answer in time", () => {
    const bws = fakeBws({ answer: () => ({ hang: true }), env: { BWS_ACCESS_TOKEN: "0.t" } });
    return Effect.gen(function* () {
      const reading = yield* driver.read({}, [SECRET_A]).pipe(Effect.forkChild);
      yield* Deferred.await(bws.spawned);
      yield* TestClock.adjust("1 minute");

      assert.deepStrictEqual(yield* Fiber.join(reading), [undefined]);
      assert.deepStrictEqual(bws.logs, ["Bitwarden did not answer in time"]);
    }).pipe(Effect.provide(bws.layer));
  });
});
