import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { BitwardenSecretProviderConfig, definition } from "./definition.ts";

const isConfig = Schema.is(BitwardenSecretProviderConfig);

describe("Bitwarden definition", () => {
  it("accepts a secret ID reference", () => {
    for (const reference of [
      "bws://be8e0ad8-d545-4017-a55a-b02f014d4158",
      "bws://BE8E0AD8-D545-4017-A55A-B02F014D4158",
    ]) {
      expect(definition.isReference(reference), reference).toBe(true);
    }
  });

  it("rejects anything that is not a secret ID reference", () => {
    for (const reference of [
      "--help",
      "be8e0ad8-d545-4017-a55a-b02f014d4158",
      "bws://be8e0ad8-d545-4017-a55a-b02f014d415",
      "bws://be8e0ad8-d545-4017-a55a-b02f014d4158 --help",
      "bws://be8e0ad8-d545-4017-a55a-b02f014d4158\n",
      "bws://project/secret",
      "op://Private/OpenAI/credential",
    ]) {
      expect(definition.isReference(reference), reference).toBe(false);
    }
  });

  it("accepts an absolute token file and an https server", () => {
    for (const config of [
      {},
      { accessTokenFile: "/run/secrets/bws_access_token" },
      { accessTokenFile: "C:\\secrets\\bws_access_token" },
      { serverUrl: "https://vault.bitwarden.eu" },
    ]) {
      expect(isConfig(config), JSON.stringify(config)).toBe(true);
    }
  });

  it("rejects a relative token file and a server that is not https", () => {
    for (const config of [
      { accessTokenFile: "bws_access_token" },
      { accessTokenFile: "/run/secrets/token\n--help" },
      { serverUrl: "http://vault.example.com" },
      { serverUrl: "--help" },
      { serverUrl: "https://vault.example.com --help" },
    ]) {
      expect(isConfig(config), JSON.stringify(config)).toBe(false);
    }
  });
});
