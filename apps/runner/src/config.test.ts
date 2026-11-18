import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeRunnerConfig, exposesDockerSocket, STARTER_CONFIG } from "./config.ts";

const configWith = (overrides: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(STARTER_CONFIG), ...overrides });

describe("runner config", () => {
  it.effect("decodes the starter config", () =>
    Effect.gen(function* () {
      const config = yield* decodeRunnerConfig("runner.json", STARTER_CONFIG);
      assert.strictEqual(config.memory, "8g");
      assert.isUndefined(config.policyFile);
    }),
  );

  it.effect("rejects invalid templates", () =>
    Effect.gen(function* () {
      const invalid = [
        { memory: "8GB" },
        { cpus: 0 },
        { pidsLimit: 10 },
        { sharedMounts: [{ source: "relative/path", target: "/mnt/x" }] },
        { sharedMounts: [{ source: "/srv/../var/run", target: "/mnt/x" }] },
        { sharedMounts: [{ source: "/srv/a,readonly=false", target: "/mnt/x" }] },
        { sharedMounts: [{ source: "/var/run", target: "/mnt/x" }] },
        { sharedMounts: [{ source: "/run/docker.sock", target: "/var/run/docker.sock" }] },
        { sharedMounts: [{ source: "/", target: "/host" }] },
        { env: { T3CODE_HOST: "0.0.0.0" } },
        { env: { "BAD NAME": "x" } },
      ];
      for (const overrides of invalid) {
        const result = yield* Effect.result(
          decodeRunnerConfig("runner.json", configWith(overrides)),
        );
        assert.strictEqual(result._tag, "Failure", JSON.stringify(overrides));
      }
    }),
  );

  it("recognizes paths that expose the Docker socket", () => {
    for (const path of ["/", "/var", "/var/run/", "/run", "/run/docker.sock", "/tmp/x.sock"]) {
      assert.isTrue(exposesDockerSocket(path), path);
    }
    for (const path of ["/srv/git-mirror", "/var/lib/pnpm-store", "/running"]) {
      assert.isFalse(exposesDockerSocket(path), path);
    }
  });
});
