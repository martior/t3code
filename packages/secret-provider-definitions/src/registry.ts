import * as Bitwarden from "@t3tools/secret-provider-bitwarden/shared/definition";
import { makeSecretProviderDefinitionRegistry } from "@t3tools/secret-provider-core/shared/definition";
import * as OnePassword from "@t3tools/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
  Bitwarden.definition,
]);
