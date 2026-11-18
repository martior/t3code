import { assert, describe, it } from "@effect/vitest";

import { isLinkAuthorized } from "./link.ts";

describe("isLinkAuthorized", () => {
  it("requires both a desired link and a stored credential", () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ['{"desired":true,"authenticated":true,"linked":false}', true],
      ['{"desired":false,"authenticated":true}', false],
      ['{"desired":true,"authenticated":false}', false],
      ["T3 Connect setup cancelled.", false],
      ["", false],
    ];
    for (const [stdout, expected] of cases) {
      assert.strictEqual(isLinkAuthorized(stdout), expected, stdout);
    }
  });
});
