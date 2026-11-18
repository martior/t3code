import { SecretProviderId } from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { emptySecretProviderDraft, secretProviderFromDraft } from "./SecretProviderDialog.logic";

const onePassword = emptySecretProviderDraft("one_password");
const bitwarden = emptySecretProviderDraft("bitwarden");

describe("secretProviderFromDraft", () => {
  it("adds a provider keyed by its name and reports every field that blocks it", () => {
    expect(
      secretProviderFromDraft(
        { ...onePassword, name: "  1Password!  ", account: "my.1password.com" },
        new Set(),
        { mode: "add" },
      ),
    ).toEqual(
      Result.succeed({
        id: "1password",
        config: {
          kind: "one_password",
          label: "1Password!",
          config: { account: "my.1password.com" },
        },
      }),
    );

    const blocked = secretProviderFromDraft(
      { ...onePassword, name: "1Password", account: "--help" },
      new Set(["1password"]),
      { mode: "add" },
    );
    expect(Result.isFailure(blocked) && Object.keys(blocked.failure).toSorted()).toEqual([
      "account",
      "name",
    ]);
  });

  it("adds a Bitwarden provider that reads its token from the environment or a file", () => {
    expect(
      secretProviderFromDraft({ ...bitwarden, name: "Bitwarden" }, new Set(), { mode: "add" }),
    ).toEqual(
      Result.succeed({
        id: "bitwarden",
        config: { kind: "bitwarden", label: "Bitwarden", config: {} },
      }),
    );
    expect(
      secretProviderFromDraft(
        {
          ...bitwarden,
          name: "Bitwarden EU",
          accessTokenFile: " /run/secrets/bws_access_token ",
          serverUrl: "https://vault.bitwarden.eu",
        },
        new Set(),
        { mode: "add" },
      ),
    ).toEqual(
      Result.succeed({
        id: "bitwarden-eu",
        config: {
          kind: "bitwarden",
          label: "Bitwarden EU",
          config: {
            accessTokenFile: "/run/secrets/bws_access_token",
            serverUrl: "https://vault.bitwarden.eu",
          },
        },
      }),
    );

    const blocked = secretProviderFromDraft(
      { ...bitwarden, name: "Bitwarden", accessTokenFile: "token", serverUrl: "http://vault" },
      new Set(),
      { mode: "add" },
    );
    expect(Result.isFailure(blocked) && Object.keys(blocked.failure).toSorted()).toEqual([
      "accessTokenFile",
      "serverUrl",
    ]);
  });

  it("keeps the id when an edit renames the provider", () => {
    const id = SecretProviderId.make("personal");
    const result = secretProviderFromDraft(
      { ...onePassword, name: "Personal (team)", account: "team.1password.com" },
      new Set(["personal"]),
      { mode: "edit", id },
    );
    expect(Result.isSuccess(result) && result.success).toEqual({
      id,
      config: {
        kind: "one_password",
        label: "Personal (team)",
        config: { account: "team.1password.com" },
      },
    });
  });
});
