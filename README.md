<!--
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2025 The Linux Foundation
-->

# 📦 Node Create .npmrc Action

<!-- markdownlint-disable-next-line MD013 -->
[![pre-commit.ci status badge]][pre-commit.ci results page]

Creates an `.npmrc` authenticated against a Nexus npm registry, then securely
removes it once the job finishes.

## node-create-npmrc-action

This action writes an `.npmrc` file containing the registry URL and a Basic
authentication entry (`_auth`) for publishing npm packages to a Sonatype Nexus
repository. The npm `_auth` field holds `base64(username:password)`, which npm
sends as an `Authorization: Basic` header.

The registry defaults to the modern Nexus 3 platform for the calling
organisation. With repository owner `onap`, the host resolves to
`nexus3.onap.org` and the registry to
`https://nexus3.onap.org/repository/npm.snapshot/`. Override any part for
projects that publish elsewhere, including the older Nexus 2 servers (such as
`nexus.onap.org`) that the defaults skip in favour of Nexus 3.

The username defaults to the calling repository name, matching the Nexus
account convention used across these projects. The action masks the password
and the derived `_auth` value in the workflow log, writes the file with `600`
permissions, and registers a post-job step that scrubs the file at the end of
the run.

## Usage Example

<!-- markdownlint-disable MD046 -->

```yaml
steps:
  - name: "Create .npmrc for Nexus"
    id: npmrc
    uses: lfreleng-actions/node-create-npmrc-action@main
    with:
      nexus_password: ${{ secrets.NPM_NEXUS_PASS }}

  - name: "Publish snapshot to Nexus"
    run: |
      VERSION="1.2.0-SNAPSHOT"
      npm version "$VERSION" --no-git-tag-version
      npm publish
```

<!-- markdownlint-enable MD046 -->

The publish step stays with the caller; this action prepares the `.npmrc`
file and stops there. By default the file lands in the current working
directory, so npm picks it up automatically.

### Loading the password from 1Password

Set `load_credential: 'true'` to fetch the password through
[`credential-load-action`](https://github.com/lfreleng-actions/credential-load-action)
rather than passing it directly.

<!-- markdownlint-disable MD046 -->

```yaml
steps:
  - name: "Create .npmrc for Nexus"
    uses: lfreleng-actions/node-create-npmrc-action@main
    with:
      load_credential: "true"
      vault_mapping_json: ${{ secrets.VAULT_MAPPING_JSON }}
      op_service_account_token: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
```

<!-- markdownlint-enable MD046 -->

## Inputs

<!-- markdownlint-disable MD013 -->

| Name                     | Required | Default                         | Description                                                                  |
| ------------------------ | -------- | ------------------------------- | ---------------------------------------------------------------------------- |
| nexus_host               | False    | `nexus3.<repository_owner>.org` | Nexus server hostname                                                        |
| nexus_repository         | False    | `npm.snapshot`                  | Nexus npm repository/location                                                |
| registry_url             | False    | n/a                             | Full registry URL override ending with `/`; ignores host/repository when set |
| scope                    | False    | n/a                             | npm scope for the auth entry (for example `@onap`)                           |
| nexus_user               | False    | Calling repository name         | Registry username                                                            |
| nexus_password           | False    | n/a                             | Registry password/token; required unless `load_credential` is `true`         |
| load_credential          | False    | false                           | Fetch the password from 1Password via `credential-load-action`               |
| vault_mapping_json       | False    | n/a                             | JSON mapping repository owner to 1Password vault (when loading a credential) |
| op_service_account_token | False    | n/a                             | 1Password service account token (when loading a credential)                  |
| path                     | False    | `.`                             | Directory in which to write `.npmrc`                                         |
| always_auth              | False    | true                            | Add `always-auth=true` to the generated `.npmrc`                             |

<!-- markdownlint-enable MD013 -->

## Outputs

<!-- markdownlint-disable MD013 -->

| Name         | Description                                |
| ------------ | ------------------------------------------ |
| npmrc_path   | Absolute path to the generated `.npmrc`    |
| registry_url | Resolved npm registry URL                  |

<!-- markdownlint-enable MD013 -->

## Implementation Details

<!-- markdownlint-disable MD013 -->

1. **Credential (optional)**: When `load_credential` is `true`, fetches the password through `credential-load-action`
2. **Registry resolution**: Builds `https://<host>/repository/<repository>/`, or uses `registry_url` verbatim when supplied
3. **Validation**: Checks the host, repository, and scope against a strict character set so the `.npmrc` structure stays intact
4. **Auth entry**: Computes `base64(username:password)`; the base64 output carries no newlines, so unusual credential characters cannot inject extra lines
5. **Write**: Emits the `.npmrc` with `600` permissions and masks the secret in the log
6. **Cleanup**: A nested post-job step overwrites and deletes the `.npmrc` at the end of the run

<!-- markdownlint-enable MD013 -->

## Notes

<!-- markdownlint-disable MD013 -->

- The auth entry uses the npm `_auth` (Basic) form: `base64(username:password)`
- The host validation accepts `A-Z a-z 0-9 . -`; the repository accepts `A-Z a-z 0-9 . _ -`
- The defaults target Nexus 3; pass `registry_url` to publish to a Nexus 2 server
- The post-job cleanup never fails the job, even when the file moved or was already removed

<!-- markdownlint-enable MD013 -->

[pre-commit.ci results page]: https://results.pre-commit.ci/latest/github/lfreleng-actions/node-create-npmrc-action/main
[pre-commit.ci status badge]: https://results.pre-commit.ci/badge/github/lfreleng-actions/node-create-npmrc-action/main.svg
