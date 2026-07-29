# Releasing Agent Hub CLI

CLI releases use an independent stable SemVer tag:

```text
cli-vX.Y.Z
```

The tag-triggered GitHub workflow verifies Go code and the installer, builds
Apple Silicon and Intel macOS archives, generates SHA-256 checksums, creates
build provenance attestations, and publishes immutable GitHub Release assets.

## Verify locally

From `src/cli`:

```sh
go test ./...
go vet ./...
go build ./...
./scripts/test-installer.sh

output="$(mktemp -d)"
./scripts/package-release.sh \
  0.1.0 \
  https://github.com/OWNER/REPOSITORY/releases/download/cli-v0.1.0 \
  "$output"
(cd "$output" && shasum -a 256 -c checksums.txt)
```

Inspect both archives before tagging. They must contain only:

```text
LICENSE
README.md
agent-hub
```

## Publish

1. Confirm the public repository remote and default branch are correct.
2. Confirm CI is green at the exact commit.
3. Create the tag locally:

   ```sh
   git tag -a cli-v0.1.0 -m "Agent Hub CLI 0.1.0"
   ```

4. Push only after explicit release approval:

   ```sh
   git push origin cli-v0.1.0
   ```

5. Verify the workflow, release assets and checksums.
6. Verify provenance:

   ```sh
   gh attestation verify agent-hub_0.1.0_darwin_arm64.tar.gz \
     -R OWNER/REPOSITORY
   ```

7. Test installation on Apple Silicon and Intel where available.
8. Set the self-hosted app configuration to the new immutable release:

   ```env
   CLI_RELEASE_VERSION="0.1.0"
   CLI_RELEASE_BASE_URL="https://github.com/OWNER/REPOSITORY/releases/download/cli-v0.1.0"
   ```

Never replace assets under an existing release. If a release is bad, point the
app back to a known-good version and publish a higher patch version.
