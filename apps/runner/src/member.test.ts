import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeMemberName } from "./member.ts";

describe("member names", () => {
  it.effect("accepts only lowercase DNS-label-like names", () =>
    Effect.gen(function* () {
      for (const name of ["a", "alice", "bob-2", "x".repeat(32)]) {
        assert.strictEqual(yield* decodeMemberName(name), name);
      }
      for (const name of ["", "Alice", "2bob", "bob-", "-bob", "a_b", "a.b", "x".repeat(33)]) {
        const result = yield* Effect.result(decodeMemberName(name));
        assert.strictEqual(result._tag, "Failure", name);
      }
    }),
  );
});
