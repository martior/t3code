#!/usr/bin/env node
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Argument, Command, Flag } from "effect/cli";

import { loadRunnerConfig, writeStarterConfig } from "./config.ts";
import * as DockerSpawner from "./DockerSpawner.ts";
import { MemberName } from "./member.ts";
import * as Spawner from "./Spawner.ts";

const configFlag = Flag.String("config").pipe(
  Flag.withAlias("c"),
  Flag.withDescription("Path to the runner config."),
  Flag.withDefault("runner.json"),
);

const memberArgument = Argument.String("name").pipe(
  Argument.withSchema(MemberName),
  Argument.withDescription("Member name: lowercase letters, digits, and dashes."),
);

const LINK_COMMAND = ["t3", "connect", "link", "--headless"];

/** Links the member's server to their own T3 account, then restarts it so it opens the tunnel. */
const linkMember = Effect.fn("runner.linkMember")(function* (member: MemberName) {
  const spawner = yield* Spawner.Spawner;
  yield* Console.log(`Have ${member} open the link below and approve with their T3 account.\n`);
  const exitCode = yield* spawner.exec(member, LINK_COMMAND, {
    tty: process.stdin.isTTY === true && process.stdout.isTTY === true,
  });
  if (exitCode !== 0) {
    yield* Console.error(
      `\n${member}'s server is running but not linked. Retry with \`t3-runner member link ${member}\`.`,
    );
    return yield* Effect.sync(() => {
      process.exitCode = 1;
    });
  }
  yield* spawner.stop(member);
  yield* spawner.start(member);
  yield* Console.log(`\n✓ ${member} is linked. They can now open it from their T3 Code apps.`);
});

const initCommand = Command.make("init", { config: configFlag }, ({ config }) =>
  writeStarterConfig(config).pipe(
    Effect.andThen(
      Console.log(`Wrote ${config}. Edit the image and limits before adding members.`),
    ),
  ),
).pipe(Command.withDescription("Write a starter runner config."));

const addCommand = Command.make(
  "add",
  { config: configFlag, member: memberArgument },
  Effect.fn("runner.member.add")(function* ({ config, member }) {
    const runnerConfig = yield* loadRunnerConfig(config);
    const spawner = yield* Spawner.Spawner;
    if ((yield* spawner.status(member)) !== "missing") {
      return yield* Console.error(`${member} already has a server. See \`t3-runner member list\`.`);
    }
    yield* spawner.create(member, runnerConfig);
    yield* spawner.start(member);
    yield* linkMember(member);
  }),
).pipe(Command.withDescription("Create and start a member's server, then link it to T3 Connect."));

const linkCommand = Command.make("link", { member: memberArgument }, ({ member }) =>
  linkMember(member),
).pipe(Command.withDescription("Link a member's running server to T3 Connect again."));

const listCommand = Command.make(
  "list",
  {},
  Effect.fn("runner.member.list")(function* () {
    const members = yield* (yield* Spawner.Spawner).list;
    if (members.length === 0) return yield* Console.log("No members yet.");
    const width = Math.max(...members.map((status) => status.member.length));
    for (const status of members) {
      yield* Console.log(`${status.member.padEnd(width)}  ${status.state}`);
    }
  }),
).pipe(Command.withDescription("List members and whether their servers run."));

const startCommand = Command.make("start", { member: memberArgument }, ({ member }) =>
  Spawner.Spawner.use((spawner) => spawner.start(member)),
).pipe(Command.withDescription("Start a member's server."));

const stopCommand = Command.make("stop", { member: memberArgument }, ({ member }) =>
  Spawner.Spawner.use((spawner) => spawner.stop(member)),
).pipe(Command.withDescription("Stop a member's server. Their data is kept."));

const removeCommand = Command.make(
  "rm",
  {
    member: memberArgument,
    wipe: Flag.Boolean("wipe").pipe(
      Flag.withDescription("Also delete the member's home, projects, and T3 data."),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("runner.member.remove")(function* ({ member, wipe }) {
    yield* (yield* Spawner.Spawner).remove(member, { wipe });
    yield* Console.log(
      wipe
        ? `Removed ${member} and deleted their data.`
        : `Removed ${member}'s server. Their data is kept; \`member add ${member}\` brings it back.`,
    );
  }),
).pipe(Command.withDescription("Remove a member's server, keeping their data unless --wipe."));

const memberCommand = Command.make("member").pipe(
  Command.withDescription("Manage members' servers."),
  Command.withSubcommands([
    addCommand,
    linkCommand,
    listCommand,
    startCommand,
    stopCommand,
    removeCommand,
  ]),
);

const upgradeCommand = Command.make(
  "upgrade",
  { config: configFlag },
  Effect.fn("runner.upgrade")(function* ({ config }) {
    const runnerConfig = yield* loadRunnerConfig(config);
    const spawner = yield* Spawner.Spawner;
    for (const { member, state } of yield* spawner.list) {
      yield* spawner.remove(member, { wipe: false });
      yield* spawner.create(member, runnerConfig).pipe(
        Effect.andThen(
          state === "running" || state === "restarting" ? spawner.start(member) : Effect.void,
        ),
        Effect.tapError(() =>
          Console.error(`${member}'s data is kept; \`member add ${member}\` recreates it.`),
        ),
      );
      yield* Console.log(`✓ ${member} recreated from ${runnerConfig.image}`);
    }
  }),
).pipe(
  Command.withDescription(
    "Recreate every member's server from the configured image. Members' data is kept.",
  ),
);

const runnerCommand = Command.make("t3-runner").pipe(
  Command.withDescription("Run one T3 Code server per member in Docker."),
  Command.withSubcommands([initCommand, memberCommand, upgradeCommand]),
);

if (import.meta.main) {
  const reportError = (error: { readonly message: string }) =>
    Console.error(error.message).pipe(
      Effect.andThen(
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      ),
    );
  Command.run(runnerCommand, { version: "0.0.0" }).pipe(
    Effect.catchTags({ RunnerConfigError: reportError, SpawnerError: reportError }),
    Effect.provide(DockerSpawner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    NodeRuntime.runMain,
  );
}
