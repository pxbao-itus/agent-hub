#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cli_directory=$(CDPATH= cd -- "$script_directory/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/agent-hub-installer-test.XXXXXX")
trap 'rm -rf "$test_root"' EXIT HUP INT TERM

fixture_directory=$test_root/release
fake_bin=$test_root/fake-bin
payload_directory=$test_root/payload
mkdir -p "$fixture_directory" "$fake_bin" "$payload_directory"

cat >"$payload_directory/agent-hub" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "version" ]; then
  echo "agent-hub 0.1.0 (commit fixture)"
  exit 0
fi
exit 1
EOF
chmod 0755 "$payload_directory/agent-hub"
printf '%s\n' "MIT License fixture" >"$payload_directory/LICENSE"
printf '%s\n' "Agent Hub CLI fixture" >"$payload_directory/README.md"

for architecture in arm64 amd64; do
  archive=$fixture_directory/agent-hub_0.1.0_darwin_${architecture}.tar.gz
  (
    cd "$payload_directory"
    tar -czf "$archive" LICENSE README.md agent-hub
  )
done

(
  cd "$fixture_directory"
  shasum -a 256 agent-hub_0.1.0_darwin_amd64.tar.gz agent-hub_0.1.0_darwin_arm64.tar.gz >checksums.txt
)

cat >"$fake_bin/uname" <<'EOF'
#!/bin/sh
case "${1:-}" in
  -s) printf '%s\n' "${TEST_UNAME_OS:-Darwin}" ;;
  -m) printf '%s\n' "${TEST_UNAME_ARCH:-arm64}" ;;
  *) exit 2 ;;
esac
EOF

cat >"$fake_bin/curl" <<'EOF'
#!/bin/sh
set -eu
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output=$2
      shift 2
      ;;
    --proto)
      shift 2
      ;;
    --fail|--silent|--show-error|--location|--tlsv1.2)
      shift
      ;;
    *)
      url=$1
      shift
      ;;
  esac
done
[ -n "$output" ] && [ -n "$url" ]
printf '%s\n' "$url" >>"$TEST_CURL_LOG"
cp "$TEST_FIXTURE_DIRECTORY/${url##*/}" "$output"
EOF
chmod 0755 "$fake_bin/uname" "$fake_bin/curl"

installer=$test_root/install.sh
(
  cd "$cli_directory"
  go run ./cmd/renderinstaller \
    --template "$script_directory/install.sh.tmpl" \
    --output "$installer" \
    --version 0.1.0 \
    --base-url https://example.test/releases/download/cli-v0.1.0
)

run_install() {
  architecture=$1
  home_directory=$test_root/home-$architecture
  install_directory=$home_directory/bin
  curl_log=$test_root/curl-$architecture.log
  mkdir -p "$home_directory"
  : >"$curl_log"
  HOME=$home_directory \
    PATH="$fake_bin:$PATH" \
    TEST_UNAME_OS=Darwin \
    TEST_UNAME_ARCH=$architecture \
    TEST_FIXTURE_DIRECTORY=$fixture_directory \
    TEST_CURL_LOG=$curl_log \
    sh "$installer" --install-dir "$install_directory"
  "$install_directory/agent-hub" version | grep "agent-hub 0.1.0" >/dev/null
  case "$architecture" in
    arm64) expected=darwin_arm64 ;;
    x86_64) expected=darwin_amd64 ;;
  esac
  grep "agent-hub_0.1.0_${expected}.tar.gz" "$curl_log" >/dev/null
}

run_install arm64
run_install x86_64

# A quoted ~/ custom destination is expanded without evaluating shell input.
tilde_home=$test_root/home-tilde
mkdir -p "$tilde_home"
HOME=$tilde_home \
  PATH="$fake_bin:$PATH" \
  TEST_UNAME_OS=Darwin \
  TEST_UNAME_ARCH=arm64 \
  TEST_FIXTURE_DIRECTORY=$fixture_directory \
  TEST_CURL_LOG=$test_root/curl-tilde.log \
  sh "$installer" --install-dir '~/.custom/bin'
"$tilde_home/.custom/bin/agent-hub" version | grep "agent-hub 0.1.0" >/dev/null

# A checksum failure must leave the existing binary untouched.
failure_home=$test_root/home-failure
failure_install=$failure_home/bin
mkdir -p "$failure_install"
cat >"$failure_install/agent-hub" <<'EOF'
#!/bin/sh
echo preserved
EOF
chmod 0755 "$failure_install/agent-hub"
cp "$fixture_directory/checksums.txt" "$test_root/checksums.valid"
sed 's/^[0-9a-f]*/0000000000000000000000000000000000000000000000000000000000000000/' \
  "$test_root/checksums.valid" >"$fixture_directory/checksums.txt"
if HOME=$failure_home \
  PATH="$fake_bin:$PATH" \
  TEST_UNAME_OS=Darwin \
  TEST_UNAME_ARCH=arm64 \
  TEST_FIXTURE_DIRECTORY=$fixture_directory \
  TEST_CURL_LOG=$test_root/curl-failure.log \
  sh "$installer" --install-dir "$failure_install"; then
  echo "checksum failure unexpectedly installed" >&2
  exit 1
fi
[ "$("$failure_install/agent-hub")" = "preserved" ]
mv "$test_root/checksums.valid" "$fixture_directory/checksums.txt"

# Unsupported operating systems fail before any download.
: >"$test_root/curl-unsupported.log"
if HOME=$test_root/home-unsupported \
  PATH="$fake_bin:$PATH" \
  TEST_UNAME_OS=Linux \
  TEST_UNAME_ARCH=x86_64 \
  TEST_FIXTURE_DIRECTORY=$fixture_directory \
  TEST_CURL_LOG=$test_root/curl-unsupported.log \
  sh "$installer"; then
  echo "unsupported OS unexpectedly installed" >&2
  exit 1
fi
[ ! -s "$test_root/curl-unsupported.log" ]

echo "Installer functional tests passed"
