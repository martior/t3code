import type { EnvironmentId, SecretProviderConfig, SecretProviderId } from "@t3tools/contracts";
import * as Result from "effect/Result";
import { useState } from "react";
import { T, useGT, useMessages, Var } from "gt-react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Radio, RadioGroup } from "../ui/radio-group";
import {
  draftFromSecretProvider,
  emptySecretProviderDraft,
  secretProviderFromDraft,
  type SecretProviderDraft,
  type SecretProviderDraftIssues,
} from "./SecretProviderDialog.logic";
import { secretProviderIcon } from "./SecretSourceInput";

const KIND_OPTIONS = [
  { kind: "one_password", name: "1Password" },
  { kind: "bitwarden", name: "Bitwarden" },
] as const;

/** Mounted per open, so each open starts from a fresh draft. */
export function SecretProviderDialog({
  onClose,
  environmentId,
  environmentLabel,
  existingIds,
  existing,
}: {
  readonly onClose: () => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly existingIds: ReadonlySet<string>;
  readonly existing?: { readonly id: SecretProviderId; readonly config: SecretProviderConfig };
}) {
  const messages = useMessages();
  const gt = useGT();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [draft, setDraft] = useState<SecretProviderDraft>(
    existing ? draftFromSecretProvider(existing.config) : emptySecretProviderDraft("one_password"),
  );
  const [submitted, setSubmitted] = useState(false);
  const result = secretProviderFromDraft(
    draft,
    existingIds,
    existing ? { mode: "edit", id: existing.id } : { mode: "add" },
    messages,
  );
  const issues: SecretProviderDraftIssues =
    submitted && Result.isFailure(result) ? result.failure : {};

  const update = (patch: Partial<SecretProviderDraft>) => setDraft({ ...draft, ...patch });
  const save = () => {
    setSubmitted(true);
    if (Result.isFailure(result)) return;
    updateSettings({ secretProviders: { [result.success.id]: result.success.config } });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? gt("Edit {label}", { label: existing.config.label })
              : gt("Add a secret provider")}
          </DialogTitle>
          <DialogDescription>
            {draft.kind === "bitwarden" ? (
              <T>
                Provider variables on <Var>{environmentLabel}</Var> can read values from it by
                secret ID. Values are read with the bws CLI on that server when a provider starts.
              </T>
            ) : (
              <T>
                Provider variables on <Var>{environmentLabel}</Var> can read values from it by name.
                Values are read with the op CLI on that server when a provider starts.
              </T>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id="secret-provider-form"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {existing ? null : (
              <RadioGroup
                aria-label={gt("Secret provider")}
                value={draft.kind}
                onValueChange={(kind) =>
                  update({ kind: kind === "bitwarden" ? "bitwarden" : "one_password" })
                }
                className="grid grid-cols-2"
              >
                {KIND_OPTIONS.map((option) => {
                  const KindIcon = secretProviderIcon(option.kind);
                  return (
                    <label
                      key={option.kind}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <Radio value={option.kind} />
                      <KindIcon className="size-4 shrink-0" aria-hidden />
                      <span className="font-medium">{option.name}</span>
                    </label>
                  );
                })}
              </RadioGroup>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="secret-provider-name">
                <T>Name</T>
              </Label>
              <Input
                id="secret-provider-name"
                placeholder={gt("Personal")}
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                maxLength={64}
                aria-invalid={issues.name !== undefined}
                aria-describedby={
                  issues.name !== undefined ? "secret-provider-name-error" : undefined
                }
                autoFocus
              />
              {issues.name !== undefined ? (
                <p
                  id="secret-provider-name-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {issues.name}
                </p>
              ) : null}
            </div>
            {draft.kind === "one_password" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="secret-provider-account">
                  <T>Account</T>
                </Label>
                <Input
                  id="secret-provider-account"
                  placeholder="my.1password.com"
                  value={draft.account}
                  onChange={(event) => update({ account: event.target.value })}
                  maxLength={253}
                  spellCheck={false}
                  aria-invalid={issues.account !== undefined}
                  aria-describedby={
                    issues.account !== undefined ? "secret-provider-account-error" : undefined
                  }
                />
                {issues.account !== undefined ? (
                  <p
                    id="secret-provider-account-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {issues.account}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  <T>
                    The account shorthand, sign-in address without https://, or ID that op account
                    list shows.
                  </T>
                </p>
              </div>
            ) : (
              <>
                <DraftField
                  id="secret-provider-token-file"
                  label={gt("Access token file")}
                  placeholder="/run/secrets/bws_access_token"
                  value={draft.accessTokenFile}
                  error={issues.accessTokenFile}
                  onChange={(accessTokenFile) => update({ accessTokenFile })}
                  hint={gt(
                    "Leave empty to use BWS_ACCESS_TOKEN from the server's environment. The token itself is never saved in settings.",
                  )}
                />
                <DraftField
                  id="secret-provider-server-url"
                  label={gt("Server URL")}
                  placeholder="https://vault.bitwarden.eu"
                  value={draft.serverUrl}
                  error={issues.serverUrl}
                  onChange={(serverUrl) => update({ serverUrl })}
                  hint={gt(
                    "Only for EU cloud or a self-hosted server. Leave empty for bitwarden.com.",
                  )}
                />
              </>
            )}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button
            type="submit"
            form="secret-provider-form"
            disabled={submitted && Result.isFailure(result)}
          >
            {existing ? gt("Save changes") : gt("Add provider")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DraftField(props: {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly hint: string;
  readonly onChange: (value: string) => void;
}) {
  const errorId = `${props.id}-error`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={4096}
        spellCheck={false}
        aria-invalid={props.error !== undefined}
        aria-describedby={props.error !== undefined ? errorId : undefined}
      />
      {props.error !== undefined ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{props.hint}</p>
    </div>
  );
}
