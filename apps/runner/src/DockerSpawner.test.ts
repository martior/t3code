import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import { decodeRunnerConfig, STARTER_CONFIG } from "./config.ts";
import * as DockerSpawner from "./DockerSpawner.ts";
import { MemberName } from "./member.ts";
import * as Spawner from "./Spawner.ts";

const encoder = new TextEncoder();
const alice = MemberName.make("alice");

interface DockerResult {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}

/** A spawner that answers `docker` calls from `respond` and records their arguments. */
const fakeDocker = (respond: (args: ReadonlyArray<string>) => DockerResult) => {
  const calls: Array<ReadonlyArray<string>> = [];
  const spawner = ChildProcessSpawner.make((command) => {
    const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
    calls.push(args);
    const result = respond(args);
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
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
  });
  const layer = DockerSpawner.layer.pipe(
    Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
  );
  return { calls, layer };
};

const flagValues = (args: ReadonlyArray<string>, flag: string) =>
  args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));

describe("DockerSpawner", () => {
  it.effect("creates an isolated, limited, non-root container", () =>
    Effect.gen(function* () {
      const config = yield* decodeRunnerConfig(
        "runner.json",
        JSON.stringify({
          ...JSON.parse(STARTER_CONFIG),
          image: "registry.example/t3-runner:1",
          memory: "6g",
          cpus: 1.5,
          pidsLimit: 2048,
          sharedMounts: [{ source: "/srv/git-mirror", target: "/mnt/git-mirror" }],
          policyFile: "/etc/t3-runner/policy.json",
          env: { GIT_MIRROR: "/mnt/git-mirror" },
        }),
      );
      const args = DockerSpawner.createArgs(alice, config);

      assert.deepStrictEqual(args.slice(0, 3), ["create", "--name", "t3-runner-alice"]);
      assert.strictEqual(args.at(-1), "registry.example/t3-runner:1");
      assert.deepStrictEqual(flagValues(args, "--user"), ["1000:1000"]);
      assert.deepStrictEqual(flagValues(args, "--network"), ["t3-runner-alice"]);
      assert.deepStrictEqual(flagValues(args, "--memory"), ["6g"]);
      assert.deepStrictEqual(flagValues(args, "--memory-swap"), ["6g"]);
      assert.deepStrictEqual(flagValues(args, "--cpus"), ["1.5"]);
      assert.deepStrictEqual(flagValues(args, "--pids-limit"), ["2048"]);
      assert.deepStrictEqual(flagValues(args, "--label"), [
        "codes.t3.runner.managed=true",
        "codes.t3.runner.member=alice",
      ]);
      assert.deepStrictEqual(flagValues(args, "--mount"), [
        "type=volume,source=t3-runner-alice,target=/home/t3",
        "type=bind,source=/srv/git-mirror,target=/mnt/git-mirror,readonly",
        "type=bind,source=/etc/t3-runner/policy.json,target=/etc/t3code/policy.json,readonly",
      ]);
      assert.deepStrictEqual(flagValues(args, "--env"), ["GIT_MIRROR=/mnt/git-mirror"]);
      assert.deepStrictEqual(flagValues(args, "--security-opt"), ["no-new-privileges"]);
      assert.notInclude(args, "--privileged");
      assert.isFalse(args.some((arg) => arg.includes("docker.sock")));
      assert.isFalse(args.some((arg) => arg === "--volume" || arg === "-v"));
    }),
  );

  it.effect("creates the member volume and network before the container", () => {
    const docker = fakeDocker((args) =>
      args[0] === "network"
        ? {
            code: 1,
            stderr: "Error response from daemon: network with name t3-runner-alice already exists",
          }
        : {},
    );
    return Effect.gen(function* () {
      const config = yield* decodeRunnerConfig("runner.json", STARTER_CONFIG);
      yield* (yield* Spawner.Spawner).create(alice, config);
      assert.deepStrictEqual(
        docker.calls.map((args) => args.slice(0, 2)),
        [
          ["volume", "create"],
          ["network", "create"],
          ["create", "--name"],
        ],
      );
      assert.strictEqual(docker.calls[0]?.at(-1), "t3-runner-alice");
    }).pipe(Effect.provide(docker.layer));
  });

  it.effect("reads member states from labeled containers", () => {
    const docker = fakeDocker(() => ({
      stdout: "alice\trunning\nbob\texited\ncarol\trestarting\nNot A Member\trunning\n\n",
    }));
    return Effect.gen(function* () {
      const spawner = yield* Spawner.Spawner;
      assert.deepStrictEqual(
        Array.from(yield* spawner.list, ({ member, state }) => [member, state]),
        [
          ["alice", "running"],
          ["bob", "stopped"],
          ["carol", "restarting"],
        ],
      );
      assert.includeMembers([...(docker.calls[0] ?? [])], ["label=codes.t3.runner.managed=true"]);
    }).pipe(Effect.provide(docker.layer));
  });

  it.effect("reports a member without a container as missing", () => {
    const docker = fakeDocker(() => ({ stdout: "" }));
    return Effect.gen(function* () {
      assert.strictEqual(yield* (yield* Spawner.Spawner).status(alice), "missing");
      assert.includeMembers([...(docker.calls[0] ?? [])], ["label=codes.t3.runner.member=alice"]);
    }).pipe(Effect.provide(docker.layer));
  });

  it.effect("keeps the volume unless wiping, and tolerates missing objects", () => {
    const docker = fakeDocker((args) =>
      args[0] === "rm"
        ? { code: 1, stderr: "Error: No such container: t3-runner-alice" }
        : args[0] === "network"
          ? { code: 1, stderr: "Error response from daemon: network t3-runner-alice not found" }
          : {},
    );
    return Effect.gen(function* () {
      const spawner = yield* Spawner.Spawner;
      yield* spawner.remove(alice, { wipe: false });
      assert.deepStrictEqual(docker.calls, [
        ["rm", "--force", "t3-runner-alice"],
        ["network", "rm", "t3-runner-alice"],
      ]);
      yield* spawner.remove(alice, { wipe: true });
      assert.deepStrictEqual(docker.calls.at(-1), ["volume", "rm", "t3-runner-alice"]);
    }).pipe(Effect.provide(docker.layer));
  });

  it.effect("surfaces docker failures with their stderr", () => {
    const docker = fakeDocker(() => ({ code: 125, stderr: "Conflict. The name is in use.\n" }));
    return Effect.gen(function* () {
      const error = yield* (yield* Spawner.Spawner).start(alice).pipe(Effect.flip);
      assert.strictEqual(error.detail, "Conflict. The name is in use.");
    }).pipe(Effect.provide(docker.layer));
  });
});
