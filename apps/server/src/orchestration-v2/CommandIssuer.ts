import {
  GuestShareId,
  ProviderInstanceId,
  ScheduledTaskId,
  ServerAuthSessionMethod,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Who issued an orchestration command, recorded on its receipt. Identifiers only, never
 * credentials. `peer` is another environment's link and `mcp-client` any other OAuth client.
 */
export const CommandIssuer = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("session"),
    sessionId: Schema.String,
    subject: Schema.String,
    method: ServerAuthSessionMethod,
  }),
  Schema.Struct({
    kind: Schema.Literals(["mcp-client", "peer"]),
    sessionId: Schema.String,
    label: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("agent"),
    threadId: ThreadId,
    providerInstanceId: ProviderInstanceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("guest"),
    threadId: ThreadId,
    shareId: GuestShareId,
  }),
  Schema.Struct({
    kind: Schema.Literal("scheduled-task"),
    taskId: ScheduledTaskId,
    trigger: Schema.Literals(["scheduled", "manual", "webhook"]),
  }),
  Schema.Struct({ kind: Schema.Literal("system") }),
]);
export type CommandIssuer = typeof CommandIssuer.Type;

/**
 * Set by each transport around the work a principal starts; dispatch reads it once and carries
 * it to the receipt. Anything no transport wraps (reactors, the effect worker, recovery) is the
 * server's own.
 */
export const CurrentCommandIssuer = Context.Reference<CommandIssuer>(
  "t3/orchestration-v2/CommandIssuer/CurrentCommandIssuer",
  { defaultValue: () => ({ kind: "system" }) },
);

export const sessionCommandIssuer = (session: {
  readonly sessionId: string;
  readonly subject: string;
  readonly method: ServerAuthSessionMethod;
}): CommandIssuer => ({
  kind: "session",
  sessionId: session.sessionId,
  subject: session.subject,
  method: session.method,
});

export const withCommandIssuer =
  (issuer: CommandIssuer) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(effect, CurrentCommandIssuer, issuer);

export const encodeCommandIssuerJson = Schema.encodeSync(Schema.fromJsonString(CommandIssuer));
const decodeCommandIssuerJson = Schema.decodeUnknownOption(Schema.fromJsonString(CommandIssuer));

/** Receipts written before issuers were recorded, or by a newer server, read as unknown (null). */
export const decodeStoredCommandIssuer = (json: string | null): CommandIssuer | null =>
  json === null ? null : Option.getOrNull(decodeCommandIssuerJson(json));
