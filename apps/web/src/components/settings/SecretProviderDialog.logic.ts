import {
  SecretProviderId,
  SecretProviderKind,
  SecretProviderLabel,
  type SecretProviderConfig,
} from "@t3tools/contracts";
import {
  BitwardenSecretProviderConfig,
  type BitwardenAccessTokenFile,
  type BitwardenServerUrl,
} from "@t3tools/secret-provider-bitwarden/shared/definition";
import {
  OnePasswordSecretProviderConfig,
  type OnePasswordAccount,
} from "@t3tools/secret-provider-onepassword/shared/definition";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../../i18n/messages";

const decodeSecretProviderId = Schema.decodeOption(SecretProviderId);
const decodeOnePasswordConfig = Schema.decodeUnknownOption(OnePasswordSecretProviderConfig);
const decodeBitwardenConfig = Schema.decodeUnknownOption(BitwardenSecretProviderConfig);

export type SecretProviderKindChoice = "one_password" | "bitwarden";

export type ClassifiedSecretProvider =
  | { readonly kind: "one_password"; readonly account: OnePasswordAccount }
  | {
      readonly kind: "bitwarden";
      readonly accessTokenFile: BitwardenAccessTokenFile | undefined;
      readonly serverUrl: BitwardenServerUrl | undefined;
    }
  | { readonly kind: "unsupported" };

/** Unknown kinds and configs that no longer decode are shown read-only; removal stays available. */
export function classifySecretProvider(provider: SecretProviderConfig): ClassifiedSecretProvider {
  if (provider.kind === "one_password") {
    const decoded = decodeOnePasswordConfig(provider.config);
    return Option.isSome(decoded)
      ? { kind: "one_password", account: decoded.value.account }
      : { kind: "unsupported" };
  }
  if (provider.kind === "bitwarden") {
    const decoded = decodeBitwardenConfig(provider.config);
    return Option.isSome(decoded)
      ? {
          kind: "bitwarden",
          accessTokenFile: decoded.value.accessTokenFile,
          serverUrl: decoded.value.serverUrl,
        }
      : { kind: "unsupported" };
  }
  return { kind: "unsupported" };
}

/** Stable and readable in settings.json, so re-adding a provider under the same name restores its variables. */
function secretProviderIdFromName(name: string): SecretProviderId | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/, "");
  return Option.getOrNull(decodeSecretProviderId(slug));
}

export interface SecretProviderDraft {
  readonly kind: SecretProviderKindChoice;
  readonly name: string;
  readonly account: string;
  /** Empty reads the token from the server's `BWS_ACCESS_TOKEN`. */
  readonly accessTokenFile: string;
  readonly serverUrl: string;
}

export const emptySecretProviderDraft = (kind: SecretProviderKindChoice): SecretProviderDraft => ({
  kind,
  name: "",
  account: "",
  accessTokenFile: "",
  serverUrl: "",
});

export function draftFromSecretProvider(provider: SecretProviderConfig): SecretProviderDraft {
  const classified = classifySecretProvider(provider);
  return {
    kind: classified.kind === "bitwarden" ? "bitwarden" : "one_password",
    name: provider.label,
    account: classified.kind === "one_password" ? classified.account : "",
    accessTokenFile: classified.kind === "bitwarden" ? (classified.accessTokenFile ?? "") : "",
    serverUrl: classified.kind === "bitwarden" ? (classified.serverUrl ?? "") : "",
  };
}

export type SecretProviderTarget =
  | { readonly mode: "add" }
  | { readonly mode: "edit"; readonly id: SecretProviderId };

export type SecretProviderDraftIssues = {
  readonly [Field in Exclude<keyof SecretProviderDraft, "kind">]?: string;
};

function decodeField<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string,
  emptyMessage: string,
): Result.Result<S["Type"], string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return Result.fail(emptyMessage);
  return Result.mapError(Schema.decodeResult(schema)(trimmed), (error) => error.message);
}

/** An empty optional field decodes to `undefined`. */
function decodeOptionalField<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: string,
): Result.Result<S["Type"] | undefined, string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return Result.succeed(undefined);
  return Result.mapError(Schema.decodeResult(schema)(trimmed), (error) => error.message);
}

function kindConfig(
  draft: SecretProviderDraft,
  resolve: MessageResolver,
): Result.Result<
  { readonly kind: SecretProviderKind; readonly config: unknown },
  SecretProviderDraftIssues
> {
  if (draft.kind === "one_password") {
    const account = decodeField(
      OnePasswordSecretProviderConfig.fields.account,
      draft.account,
      resolve(msg("Enter the 1Password account.")),
    );
    return Result.isFailure(account)
      ? Result.fail({ account: account.failure })
      : Result.succeed({
          kind: SecretProviderKind.make("one_password"),
          config: { account: account.success },
        });
  }
  const accessTokenFile = decodeOptionalField(
    BitwardenSecretProviderConfig.fields.accessTokenFile,
    draft.accessTokenFile,
  );
  const serverUrl = decodeOptionalField(
    BitwardenSecretProviderConfig.fields.serverUrl,
    draft.serverUrl,
  );
  if (Result.isFailure(accessTokenFile) || Result.isFailure(serverUrl)) {
    return Result.fail({
      ...(Result.isFailure(accessTokenFile)
        ? {
            accessTokenFile: resolve(
              msg("Enter an absolute path, such as {example}.", {
                example: "/run/secrets/bws_access_token",
              }),
            ),
          }
        : {}),
      ...(Result.isFailure(serverUrl)
        ? { serverUrl: resolve(msg("Enter an address that starts with https://.")) }
        : {}),
    });
  }
  return Result.succeed({
    kind: SecretProviderKind.make("bitwarden"),
    config: {
      ...(accessTokenFile.success === undefined
        ? {}
        : { accessTokenFile: accessTokenFile.success }),
      ...(serverUrl.success === undefined ? {} : { serverUrl: serverUrl.success }),
    },
  });
}

/** The settings entry a draft adds or replaces, or every field that blocks it, one message each. */
export function secretProviderFromDraft(
  draft: SecretProviderDraft,
  existingIds: ReadonlySet<string>,
  target: SecretProviderTarget,
  resolve: MessageResolver = m,
): Result.Result<
  { readonly id: SecretProviderId; readonly config: SecretProviderConfig },
  SecretProviderDraftIssues
> {
  const label = decodeField(SecretProviderLabel, draft.name, resolve(msg("Enter a name.")));
  const kind = kindConfig(draft, resolve);

  let id: SecretProviderId | null = null;
  let nameIssue: string | undefined;
  if (Result.isFailure(label)) {
    nameIssue = label.failure;
  } else {
    id = target.mode === "edit" ? target.id : secretProviderIdFromName(label.success);
    if (id === null) nameIssue = resolve(msg("The name needs at least one letter or digit."));
    else if (target.mode === "add" && existingIds.has(id))
      nameIssue = resolve(msg("A secret provider with this name exists."));
  }

  if (id === null || nameIssue !== undefined || Result.isFailure(label) || Result.isFailure(kind)) {
    return Result.fail({
      ...(nameIssue === undefined ? {} : { name: nameIssue }),
      ...(Result.isFailure(kind) ? kind.failure : {}),
    });
  }
  return Result.succeed({
    id,
    config: { kind: kind.success.kind, label: label.success, config: kind.success.config },
  });
}
