#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 <version> [output-directory] [preview|stable]" >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 3 ] || usage

version=$1
output_directory=${2:-dist}
channel=${3:-preview}
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cli_directory=$(CDPATH= cd -- "$script_directory/.." && pwd)
repository_directory=$(CDPATH= cd -- "$cli_directory/.." && pwd)

case "$output_directory" in
  /*) ;;
  *) output_directory=$(pwd)/$output_directory ;;
esac

case "$channel" in
  preview|stable) ;;
  *) usage ;;
esac

commit=$(git -C "$repository_directory" rev-parse --verify HEAD)
epoch=${SOURCE_DATE_EPOCH:-$(git -C "$repository_directory" show -s --format=%ct HEAD)}
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/agent-hub-release.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

mkdir -p "$output_directory"
release_directory=$output_directory/cli-v$version
if [ -e "$output_directory/release.json" ] || [ -e "$release_directory" ]; then
  echo "output already contains release metadata for cli-v$version" >&2
  exit 1
fi
mkdir -p "$release_directory"
arm64_archive=
amd64_archive=

for architecture in arm64 amd64; do
  binary="$temporary_directory/agenthub-$architecture"
  (
    cd "$cli_directory"
    CGO_ENABLED=0 GOOS=darwin GOARCH=$architecture go build \
      -trimpath \
      -ldflags "-s -w -X agent-hub-cli/internal/buildinfo.Version=$version -X agent-hub-cli/internal/buildinfo.Commit=$commit" \
      -o "$binary" \
      .
  )
  archive=$(
    cd "$cli_directory"
    go run ./cmd/releasepack \
      --version "$version" \
      --arch "$architecture" \
      --binary "$binary" \
      --license "$repository_directory/LICENSE" \
      --readme "$cli_directory/README.md" \
      --output "$release_directory" \
      --epoch "$epoch"
  )
  case "$architecture" in
    arm64) arm64_archive=$archive ;;
    amd64) amd64_archive=$archive ;;
  esac
done

(
  cd "$cli_directory"
  go run ./cmd/renderinstaller \
    --template "$cli_directory/scripts/install.sh.tmpl" \
    --output "$release_directory/install.sh" \
    --version "$version"
)

(
  cd "$cli_directory"
  go run ./cmd/checksums \
    --output "$release_directory/checksums.txt" \
    "$arm64_archive" \
    "$amd64_archive" \
    "$release_directory/install.sh"
)

(
  cd "$cli_directory"
  go run ./cmd/releasemanifest \
    --output "$output_directory/release.json" \
    --version "$version" \
    --channel "$channel"
)

echo "Release assets written to $output_directory"
echo "Copy this directory to public/releases/cli on the Agent Hub host."
