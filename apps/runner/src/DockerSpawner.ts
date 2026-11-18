import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { RunnerConfig } from "./config.ts";
import {
  containerName,
  MANAGED_LABEL,
  MEMBER_LABEL,
  MemberName,
  networkName,
  volumeName,
} from "./member.ts";
import * as Spawner from "./Spawner.ts";

/** The image's `t3` user. Passed explicitly so an image without `USER` still never runs as root. */
const CONTAINER_USER = "1000:1000";
const CONTAINER_HOME = "/home/t3";
const POLICY_TARGET = "/etc/t3code/policy.json";

const bindMount = (source: string, target: string) =>
  `type=bind,source=${source},target=${target},readonly`;

const volumeCreateArgs = (member: MemberName): ReadonlyArray<string> => [
  "volume",
  "create",
  "--label",
  `${MANAGED_LABEL}=true`,
  "--label",
  `${MEMBER_LABEL}=${member}`,
  volumeName(member),
];

// Each member gets its own bridge network: outbound access works, but no member can reach
// another member's dev servers or ports.
const networkCreateArgs = (member: MemberName): ReadonlyArray<string> => [
  "network",
  "create",
  "--driver",
  "bridge",
  "--label",
  `${MANAGED_LABEL}=true`,
  "--label",
  `${MEMBER_LABEL}=${member}`,
  networkName(member),
];

export const createArgs = (member: MemberName, config: RunnerConfig): ReadonlyArray<string> => [
  "create",
  "--name",
  containerName(member),
  "--hostname",
  member,
  "--network",
  networkName(member),
  "--label",
  `${MANAGED_LABEL}=true`,
  "--label",
  `${MEMBER_LABEL}=${member}`,
  "--user",
  CONTAINER_USER,
  "--init",
  "--restart",
  "unless-stopped",
  "--security-opt",
  "no-new-privileges",
  "--cap-drop",
  "ALL",
  "--memory",
  config.memory,
  "--memory-swap",
  config.memory,
  "--cpus",
  String(config.cpus),
  "--pids-limit",
  String(config.pidsLimit),
  "--mount",
  `type=volume,source=${volumeName(member)},target=${CONTAINER_HOME}`,
  ...config.sharedMounts.flatMap((mount) => ["--mount", bindMount(mount.source, mount.target)]),
  ...(config.policyFile === undefined
    ? []
    : ["--mount", bindMount(config.policyFile, POLICY_TARGET)]),
  ...Object.entries(config.env).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
  config.image,
];

const listArgs = (member?: MemberName): ReadonlyArray<string> => [
  "ps",
  "--all",
  "--filter",
  `label=${MANAGED_LABEL}=true`,
  ...(member === undefined ? [] : ["--filter", `label=${MEMBER_LABEL}=${member}`]),
  "--format",
  `{{.Label "${MEMBER_LABEL}"}}\t{{.State}}`,
];

const toMemberState = (dockerState: string): Spawner.MemberState => {
  switch (dockerState) {
    case "running":
    case "restarting":
    case "paused":
      return dockerState;
    default:
      return "stopped";
  }
};

const isMemberName = Schema.is(MemberName);

/** Parses `docker ps` output from `listArgs`, skipping rows whose label is not a member name. */
const parseStatusLines = (stdout: string): ReadonlyArray<Spawner.MemberStatus> =>
  stdout.split("\n").flatMap((line) => {
    const [member, state] = line.trim().split("\t");
    return member !== undefined && state !== undefined && isMemberName(member)
      ? [{ member, state: toMemberState(state) }]
      : [];
  });

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const run = Effect.fn("DockerSpawner.run")(function* (
    operation: string,
    args: ReadonlyArray<string>,
    options?: { readonly allowMissing?: boolean; readonly allowExisting?: boolean },
  ) {
    const fail = (detail: string) => new Spawner.SpawnerError({ operation, detail });
    const { stdout, stderr, exitCode } = yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(ChildProcess.make("docker", [...args]));
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [collect(child.stdout), collect(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { stdout, stderr, exitCode };
    }).pipe(
      Effect.scoped,
      Effect.mapError((error) => fail(error.message)),
    );
    if (exitCode === 0) return stdout;
    if (
      options?.allowMissing === true &&
      /no such (container|volume|object)|network \S+ not found/i.test(stderr)
    ) {
      return "";
    }
    if (options?.allowExisting === true && /already exists/i.test(stderr)) return "";
    return yield* fail(stderr.trim().slice(-500) || `docker exited with ${exitCode}`);
  });

  const list = run("list members", listArgs()).pipe(Effect.map(parseStatusLines));

  return Spawner.Spawner.of({
    create: Effect.fn("DockerSpawner.create")(function* (member, config) {
      yield* run("create volume", volumeCreateArgs(member));
      yield* run("create network", networkCreateArgs(member), { allowExisting: true });
      yield* run("create container", createArgs(member, config));
    }),
    start: Effect.fn("DockerSpawner.start")(function* (member) {
      yield* run("start", ["start", containerName(member)]);
    }),
    stop: Effect.fn("DockerSpawner.stop")(function* (member) {
      yield* run("stop", ["stop", containerName(member)]);
    }),
    status: Effect.fn("DockerSpawner.status")(function* (member) {
      const [status] = parseStatusLines(yield* run("status", listArgs(member)));
      return status?.state ?? "missing";
    }),
    list,
    remove: Effect.fn("DockerSpawner.remove")(function* (member, { wipe }) {
      yield* run("remove container", ["rm", "--force", containerName(member)], {
        allowMissing: true,
      });
      yield* run("remove network", ["network", "rm", networkName(member)], { allowMissing: true });
      if (wipe) {
        yield* run("remove volume", ["volume", "rm", volumeName(member)], { allowMissing: true });
      }
    }),
    output: Effect.fn("DockerSpawner.output")(function* (member, command) {
      return yield* run("exec", ["exec", containerName(member), ...command]);
    }),
    exec: Effect.fn("DockerSpawner.exec")(function* (member, command, { tty }) {
      const docker = ChildProcess.make(
        "docker",
        ["exec", tty ? "-it" : "-i", containerName(member), ...command],
        { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
      );
      return yield* spawner.spawn(docker).pipe(
        Effect.flatMap((child) => child.exitCode),
        Effect.map(Number),
        Effect.scoped,
        Effect.mapError(
          (error) => new Spawner.SpawnerError({ operation: "exec", detail: error.message }),
        ),
      );
    }),
  });
});

export const layer = Layer.effect(Spawner.Spawner, make);
