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
  0.2.0 \
  "$output" \
  preview
(cd "$output/cli-v0.2.0" && shasum -a 256 -c checksums.txt)
```

Inspect both archives before tagging. They must contain only:

```text
LICENSE
README.md
agenthub
```

## Publish

1. Confirm the public repository remote and default branch are correct.
2. Confirm CI is green at the exact commit.
3. Create the tag locally:

   ```sh
   git tag -a cli-v0.2.0 -m "Agent Hub CLI 0.2.0"
   ```

4. Push only after explicit release approval:

   ```sh
   git push origin cli-v0.2.0
   ```

5. Verify the workflow, release assets and checksums.
6. Verify provenance:

   ```sh
   gh attestation verify agenthub_0.2.0_darwin_arm64.tar.gz \
     -R pxbao-itus/agent-hub
   ```

7. Test installation on Apple Silicon and Intel where available.
8. Deploy the complete generated bundle to each self-hosted instance:

   ```sh
   cp -R "$output"/. /path/to/agent-hub/public/releases/cli/
   ```

   `release.json` is the active pointer and must be deployed after its versioned
   asset directory. Docker Compose mounts this directory read-only.

Never replace assets under an existing versioned directory. If a release is
bad, restore the previous `release.json` and publish a higher patch version.
