#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 <version> <release-base-url> [output-directory]" >&2
  exit 2
}

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage

version=$1
release_base_url=${2%/}
output_directory=${3:-dist}
script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cli_directory=$(CDPATH= cd -- "$script_directory/.." && pwd)
repository_directory=$(CDPATH= cd -- "$cli_directory/.." && pwd)

case "$output_directory" in
  /*) ;;
  *) output_directory=$(pwd)/$output_directory ;;
esac

case "$release_base_url" in
  https://*) ;;
  *)
    echo "release base URL must use HTTPS" >&2
    exit 2
    ;;
esac

commit=$(git -C "$repository_directory" rev-parse --verify HEAD)
epoch=${SOURCE_DATE_EPOCH:-$(git -C "$repository_directory" show -s --format=%ct HEAD)}
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/agent-hub-release.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

mkdir -p "$output_directory"
arm64_archive=
amd64_archive=

for architecture in arm64 amd64; do
  binary="$temporary_directory/agent-hub-$architecture"
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
      --output "$output_directory" \
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
    --output "$output_directory/install.sh" \
    --version "$version" \
    --base-url "$release_base_url"
)

(
  cd "$cli_directory"
  go run ./cmd/checksums \
    --output "$output_directory/checksums.txt" \
    "$arm64_archive" \
    "$amd64_archive" \
    "$output_directory/install.sh"
)

echo "Release assets written to $output_directory"
echo "Release base URL: $release_base_url"
