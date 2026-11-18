import { SecretProviderKind } from "@t3tools/contracts";
import { defineSecretProvider } from "@t3tools/secret-provider-core/shared/definition";
import * as Schema from "effect/Schema";

/** Absolute, so it never depends on the server's working directory. */
export const BitwardenAccessTokenFile = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter((value: string) =>
    /^(?:\/|[A-Za-z]:[\\/])[^\0\r\n]*$/.test(value)
      ? true
      : "The access token file must be an absolute path, such as /run/secrets/bws_access_token.",
  ),
).pipe(Schema.brand("BitwardenAccessTokenFile"));
export type BitwardenAccessTokenFile = typeof BitwardenAccessTokenFile.Type;

const isHttpsUrl = (value: string) => {
  if (value.startsWith("-") || /\s/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Passed to `bws --server-url`, for self-hosted or EU cloud servers. */
export const BitwardenServerUrl = Schema.String.check(
  Schema.isMaxLength(2048),
  Schema.makeFilter((value: string) =>
    isHttpsUrl(value) ? true : "The Bitwarden server URL must start with https://.",
  ),
).pipe(Schema.brand("BitwardenServerUrl"));
export type BitwardenServerUrl = typeof BitwardenServerUrl.Type;

/** Without `accessTokenFile`, the token comes from the server's own `BWS_ACCESS_TOKEN`. */
export const BitwardenSecretProviderConfig = Schema.Struct({
  accessTokenFile: Schema.optionalKey(BitwardenAccessTokenFile),
  serverUrl: Schema.optionalKey(BitwardenServerUrl),
});
export type BitwardenSecretProviderConfig = typeof BitwardenSecretProviderConfig.Type;

// Bitwarden has no path references, so a secret is named by its ID.
const REFERENCE = /^bws:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The secret ID a valid reference names. */
export const bitwardenSecretId = (reference: string) => reference.slice("bws://".length);

export const definition = defineSecretProvider({
  kind: SecretProviderKind.make("bitwarden"),
  label: "Bitwarden",
  configSchema: BitwardenSecretProviderConfig,
  isReference: (reference) => REFERENCE.test(reference),
  referencePlaceholder: "bws://00000000-0000-0000-0000-000000000000",
  invalidReferenceMessage: "Use a Bitwarden reference like bws://<secret-id>.",
});
