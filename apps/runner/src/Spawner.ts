import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { RunnerConfig } from "./config.ts";
import type { MemberName } from "./member.ts";

export type MemberState = "running" | "restarting" | "paused" | "stopped" | "missing";

export interface MemberStatus {
  readonly member: MemberName;
  readonly state: MemberState;
}

export class SpawnerError extends Schema.TaggedError<SpawnerError>()("SpawnerError", {
  operation: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.operation} failed: ${this.detail}`;
  }
}

/** Runs one T3 server per member. Docker is the only backend; keep this small for the next. */
export class Spawner extends Context.Service<
  Spawner,
  {
    /** Creates the member's persistent storage (kept if it exists) and a stopped server. */
    readonly create: (
      member: MemberName,
      config: RunnerConfig,
    ) => Effect.Effect<void, SpawnerError>;
    readonly start: (member: MemberName) => Effect.Effect<void, SpawnerError>;
    readonly stop: (member: MemberName) => Effect.Effect<void, SpawnerError>;
    readonly status: (member: MemberName) => Effect.Effect<MemberState, SpawnerError>;
    readonly list: Effect.Effect<ReadonlyArray<MemberStatus>, SpawnerError>;
    /** Removes the server; `wipe` also deletes the member's storage. */
    readonly remove: (
      member: MemberName,
      options: { readonly wipe: boolean },
    ) => Effect.Effect<void, SpawnerError>;
    /** Runs a command in the member's running server and returns its stdout. */
    readonly output: (
      member: MemberName,
      command: ReadonlyArray<string>,
    ) => Effect.Effect<string, SpawnerError>;
    /** Runs a command in the member's running server with this terminal attached. */
    readonly exec: (
      member: MemberName,
      command: ReadonlyArray<string>,
      options: { readonly tty: boolean },
    ) => Effect.Effect<number, SpawnerError>;
  }
>()("@t3tools/runner/Spawner") {}
