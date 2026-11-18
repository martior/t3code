# Bitwarden Secrets Manager

Use Bitwarden Secrets Manager to keep credentials in Bitwarden and have T3 Code read them when it
needs them. T3 Code signs in with a machine account's access token, so nothing needs approving or
unlocking. It works on a headless host, a VM, a container, or a
[background service](./background-service.md) you reach through [remote access](./remote-access.md).

For the basics, see [Secrets](./secrets.md).

## Set it up

1. In Bitwarden Secrets Manager, create a machine account.
2. Give it read access to only the projects that hold the secrets T3 Code needs.
3. Create an access token for the machine account and copy it. It is shown once.
4. Install the [Secrets Manager CLI](https://bitwarden.com/help/secrets-manager-cli/) (`bws`) on the
   machine that runs the T3 Code server, so `bws` is on the server's `PATH`.
5. Give the server the token in one of two ways:
   - **Environment.** Put `BWS_ACCESS_TOKEN` in the server's environment. For a background service,
     add it to `service.env` and restart the service. See
     [Configure the service environment](./background-service.md#configure-the-service-environment).
   - **File.** Save the token in a file only the server's user can read, for example a container
     secret mounted at `/run/secrets/bws_access_token`.
6. In **Settings → Secrets**, select **Add provider**, pick **Bitwarden**, and enter a name. For a
   token file, enter its absolute path in **Access token file**. Leave it empty to use
   `BWS_ACCESS_TOKEN`.
7. If your organization is on the EU cloud or a self-hosted server, enter its address in
   **Server URL**, for example `https://vault.bitwarden.eu`. Leave it empty for bitwarden.com.

## Reference a secret

Bitwarden names a secret by its ID, not by a path. Copy the secret's ID in Secrets Manager and
write it after `bws://`:

```text
bws://be8e0ad8-d545-4017-a55a-b02f014d4158
```

T3 Code reads the secret's value. Renaming the secret or moving it to another project keeps the
reference working, as long as the machine account can still read it.

## Check that it works

On the server's machine, read a secret with the same token the server uses:

```bash
BWS_ACCESS_TOKEN="$(cat /run/secrets/bws_access_token)" \
  bws secret get be8e0ad8-d545-4017-a55a-b02f014d4158 >/dev/null && echo "Secret read"
```

If it prints `Secret read`, the token can read the secret. This checks your shell, not the server.
To confirm the server can read it, use the reference in a setting and select the check button next
to it. If the server cannot read the secret, the feature that needs it shows an error naming the
secret provider. The server log says why, for example that `bws` is not installed, the token is
missing or rejected, or the secret was not found.

## Things to know

- Agents run with the server's environment. With `BWS_ACCESS_TOKEN` set there, an agent can use the
  token to read anything the machine account can. A token file keeps the token out of that
  environment, but an agent that can read the file can still use it.
- Give the machine account only projects whose secrets you would let an agent read.
- T3 Code waits up to 30 seconds for Bitwarden. After that the secret counts as unreadable.
- A token from a file takes precedence over `BWS_ACCESS_TOKEN`.
