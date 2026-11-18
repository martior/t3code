import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

const DOCKER_SOCKETS = ["/var/run/docker.sock", "/run/docker.sock"];

/** True when mounting `source` would put a Docker socket inside the container. */
export const exposesDockerSocket = (source: string): boolean => {
  const path = source.length > 1 ? source.replace(/\/+$/, "") : source;
  if (path === "/" || path.endsWith(".sock")) return true;
  return DOCKER_SOCKETS.some((socket) => socket === path || socket.startsWith(`${path}/`));
};

const AbsolutePath = Schema.String.check(
  Schema.makeFilter(
    (path: string) =>
      path.startsWith("/") && !path.includes(",") && !path.split("/").includes(".."),
    { description: "an absolute path without ',' or '..'" },
  ),
);

const SharedMount = Schema.Struct({
  source: AbsolutePath.check(
    Schema.makeFilter((source: string) => !exposesDockerSocket(source), {
      description: "a path that does not expose the Docker socket",
    }),
  ),
  target: AbsolutePath,
});

// The image sets these so the server keeps its state in the member volume and stays on loopback.
const RESERVED_ENV = new Set(["HOME", "T3CODE_HOME", "T3CODE_HOST", "T3CODE_PORT"]);

const isEnvName = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_ENV.has(name.toUpperCase());

export const RunnerConfig = Schema.Struct({
  image: Schema.String.check(Schema.isNonEmpty()),
  /** Docker memory size such as `8g`; swap is capped to the same value. */
  memory: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*[kmg]$/)),
  cpus: Schema.Number.check(Schema.isGreaterThan(0)),
  pidsLimit: Schema.Int.check(Schema.isGreaterThanOrEqualTo(64)),
  sharedMounts: Schema.Array(SharedMount),
  policyFile: Schema.optionalKey(
    AbsolutePath.check(
      Schema.makeFilter((source: string) => !exposesDockerSocket(source), {
        description: "a policy file path",
      }),
    ),
  ),
  env: Schema.Record(Schema.String, Schema.String).check(
    Schema.makeFilter((env: Record<string, string>) => Object.keys(env).every(isEnvName), {
      description: "environment variable names the image does not own",
    }),
  ),
});
export type RunnerConfig = typeof RunnerConfig.Type;

const decodeRunnerConfigJson = Schema.decodeEffect(Schema.fromJsonString(RunnerConfig));

export class RunnerConfigError extends Schema.TaggedError<RunnerConfigError>()(
  "RunnerConfigError",
  {
    path: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.path}: ${this.reason}`;
  }
}

export const STARTER_CONFIG = `{
  "image": "t3-runner:latest",
  "memory": "8g",
  "cpus": 2,
  "pidsLimit": 4096,
  "sharedMounts": [],
  "env": {}
}
`;

export const decodeRunnerConfig = (path: string, text: string) =>
  decodeRunnerConfigJson(text).pipe(
    Effect.mapError((error) => new RunnerConfigError({ path, reason: error.message })),
  );

export const loadRunnerConfig = Effect.fn("RunnerConfig.load")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(path).pipe(
    Effect.mapError(
      () =>
        new RunnerConfigError({
          path,
          reason: "cannot read the config. Run `t3-runner init` to create one.",
        }),
    ),
  );
  return yield* decodeRunnerConfig(path, text);
});

export const writeStarterConfig = Effect.fn("RunnerConfig.writeStarter")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(path)) {
    return yield* new RunnerConfigError({ path, reason: "already exists; not overwriting it." });
  }
  yield* fs.writeFileString(path, STARTER_CONFIG);
});
