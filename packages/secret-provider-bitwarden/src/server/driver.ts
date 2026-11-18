import {
  isCommandMissingCause,
  spawnAndCollect,
} from "@t3tools/provider-core/server/snapshotProbe";
import { defineSecretProviderDriver } from "@t3tools/secret-provider-core/server/driver";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

import {
  bitwardenSecretId,
  definition,
  type BitwardenAccessTokenFile,
  type BitwardenServerUrl,
} from "../shared/definition.ts";

// The Secrets Manager CLI. The Password Manager CLI (`bw`) needs an interactive unlock.
const BWS_BINARY = "bws";
const READ_TIMEOUT = Duration.seconds(30);
// `bws` reads one secret per run and signs in each time, so a few run at once.
const READ_CONCURRENCY = 4;

const decodeSecret = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ value: Schema.String })),
);

// A secret is passed on verbatim; surrounding whitespace can be part of it.
const nonEmpty = (value: string) => (value.trim().length > 0 ? value : undefined);

const TOKEN_FAILURE = /access token|invalid_client|invalid_grant|unauthori[sz]ed|\b401\b/i;
const SECRET_UNAVAILABLE = /not found|\b404\b|forbidden|\b403\b/i;

/** Fails with a reason that stops every read, since no secret can be read without a token. */
const accessToken = Effect.fn("BitwardenDriver.accessToken")(function* (
  file: BitwardenAccessTokenFile | undefined,
) {
  if (file === undefined) {
    const fromEnvironment = yield* Config.option(Config.Redacted("BWS_ACCESS_TOKEN")).pipe(
      Effect.orElseSucceed(() => Option.none<Redacted.Redacted<string>>()),
    );
    if (Option.isSome(fromEnvironment) && Redacted.value(fromEnvironment.value).trim() !== "") {
      return fromEnvironment.value;
    }
    return yield* Effect.fail(
      "No Bitwarden access token: BWS_ACCESS_TOKEN is not set in the server's environment",
    );
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const token = yield* fileSystem
    .readFileString(file)
    .pipe(Effect.mapError(() => "Could not read the Bitwarden access token file"));
  if (token.trim() === "") return yield* Effect.fail("The Bitwarden access token file is empty");
  return Redacted.make(token.trim());
});

// The token goes through the environment, never argv, where other users could see it.
const readOne = Effect.fn("BitwardenDriver.readOne")(function* (
  token: Redacted.Redacted<string>,
  serverUrl: BitwardenServerUrl | undefined,
  reference: string,
) {
  const args = [
    "--output",
    "json",
    "--color",
    "no",
    ...(serverUrl === undefined ? [] : [`--server-url=${serverUrl}`]),
    "secret",
    "get",
    bitwardenSecretId(reference),
  ];
  const spawnCommand = yield* resolveSpawnCommand(BWS_BINARY, args);
  const result = yield* spawnAndCollect(
    BWS_BINARY,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, {
      shell: spawnCommand.shell,
      env: { BWS_ACCESS_TOKEN: token },
      extendEnv: true,
    }),
  ).pipe(
    Effect.mapError((error) =>
      isCommandMissingCause(error)
        ? "The Bitwarden Secrets Manager CLI (bws) is not installed on the server"
        : `Could not run the Bitwarden Secrets Manager CLI (${error._tag})`,
    ),
  );
  if (result.code === 0) {
    const secret = decodeSecret(result.stdout);
    if (Option.isSome(secret)) return nonEmpty(secret.value.value);
    yield* Effect.logWarning("Bitwarden returned a secret in an unexpected format");
    return undefined;
  }
  if (TOKEN_FAILURE.test(result.stderr)) {
    return yield* Effect.fail("Bitwarden rejected the access token");
  }
  yield* Effect.logWarning(
    SECRET_UNAVAILABLE.test(result.stderr)
      ? "Bitwarden secret not found, or the machine account cannot read it"
      : "Could not read secret from Bitwarden",
    { exitCode: result.code },
  );
  return undefined;
});

export const driver = defineSecretProviderDriver({
  kind: definition.kind,
  definition,
  read: Effect.fn("BitwardenDriver.read")(function* ({ accessTokenFile, serverUrl }, references) {
    // One deadline covers every read; a reference not read by then is unreadable.
    const values: Array<string | undefined> = references.map(() => undefined);
    const outcome = yield* Effect.gen(function* () {
      const token = yield* accessToken(accessTokenFile);
      yield* Effect.forEach(
        references,
        (reference, index) =>
          readOne(token, serverUrl, reference).pipe(
            Effect.map((value) => {
              values[index] = value;
            }),
          ),
        { concurrency: READ_CONCURRENCY, discard: true },
      );
    }).pipe(
      Effect.catch((reason) => Effect.logWarning(reason, { references: references.length })),
      Effect.timeoutOption(READ_TIMEOUT),
    );
    if (Option.isNone(outcome)) {
      yield* Effect.logWarning("Bitwarden did not answer in time", {
        references: references.length,
      });
    }
    return values;
  }),
});
