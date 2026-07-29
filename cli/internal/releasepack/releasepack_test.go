package releasepack

import (
	"archive/tar"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestArchiveName(t *testing.T) {
	got, err := ArchiveName("1.2.3", "arm64")
	if err != nil {
		t.Fatal(err)
	}
	if got != "agenthub_1.2.3_darwin_arm64.tar.gz" {
		t.Fatalf("ArchiveName() = %q", got)
	}
	for _, value := range []string{"v1.2.3", "1.2", "../1.2.3"} {
		if _, err := ArchiveName(value, "arm64"); err == nil {
			t.Fatalf("expected invalid version %q", value)
		}
	}
	if _, err := ArchiveName("1.2.3", "386"); err == nil {
		t.Fatal("expected unsupported architecture")
	}
}

func TestCreateArchiveIsDeterministic(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "agenthub")
	readme := filepath.Join(dir, "README.md")
	if err := os.WriteFile(binary, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readme, []byte("readme"), 0o644); err != nil {
		t.Fatal(err)
	}
	files := []InputFile{
		{Source: readme, Name: "README.md", Mode: 0o644},
		{Source: binary, Name: "agenthub", Mode: 0o755},
	}
	epoch := time.Unix(1_700_000_000, 0)
	first := filepath.Join(dir, "first.tar.gz")
	second := filepath.Join(dir, "second.tar.gz")
	if err := CreateArchive(first, epoch, files); err != nil {
		t.Fatal(err)
	}
	if err := CreateArchive(second, epoch, files); err != nil {
		t.Fatal(err)
	}
	firstHash, _ := SHA256(first)
	secondHash, _ := SHA256(second)
	if firstHash != secondHash {
		t.Fatalf("archive hashes differ: %s != %s", firstHash, secondHash)
	}

	file, err := os.Open(first)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	reader := tar.NewReader(gz)
	var names []string
	var modes []int64
	for {
		header, err := reader.Next()
		if err != nil {
			break
		}
		names = append(names, header.Name)
		modes = append(modes, header.Mode)
	}
	if strings.Join(names, ",") != "README.md,agenthub" {
		t.Fatalf("archive entries = %v", names)
	}
	if modes[1] != 0o755 {
		t.Fatalf("binary mode = %o", modes[1])
	}
}

func TestWriteChecksumsSorted(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.tar.gz")
	b := filepath.Join(dir, "b.tar.gz")
	_ = os.WriteFile(a, []byte("a"), 0o644)
	_ = os.WriteFile(b, []byte("b"), 0o644)
	output := filepath.Join(dir, "checksums.txt")
	if err := WriteChecksums(output, []string{b, a}); err != nil {
		t.Fatal(err)
	}
	content, _ := os.ReadFile(output)
	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	if !strings.HasSuffix(lines[0], "  a.tar.gz") || !strings.HasSuffix(lines[1], "  b.tar.gz") {
		t.Fatalf("checksums not sorted:\n%s", content)
	}
}

func TestRenderInstaller(t *testing.T) {
	dir := t.TempDir()
	template := filepath.Join(dir, "install.sh.tmpl")
	destination := filepath.Join(dir, "install.sh")
	content := "version=__CLI_VERSION__\n"
	if err := os.WriteFile(template, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := RenderInstaller(template, destination, "1.2.3"); err != nil {
		t.Fatal(err)
	}
	rendered, _ := os.ReadFile(destination)
	if string(rendered) != "version=1.2.3\n" {
		t.Fatalf("rendered installer:\n%s", rendered)
	}
	info, _ := os.Stat(destination)
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("installer mode = %o", info.Mode().Perm())
	}
	if err := RenderInstaller(template, destination, "v1.2.3"); err == nil {
		t.Fatal("expected invalid version")
	}
}

func TestWriteManifest(t *testing.T) {
	destination := filepath.Join(t.TempDir(), "release.json")
	if err := WriteManifest(destination, "1.2.3", "preview"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	expected := `{
  "schemaVersion": 1,
  "version": "1.2.3",
  "channel": "preview",
  "releasePath": "cli-v1.2.3",
  "assets": {
    "darwinArm64": "agenthub_1.2.3_darwin_arm64.tar.gz",
    "darwinAmd64": "agenthub_1.2.3_darwin_amd64.tar.gz",
    "checksums": "checksums.txt",
    "installer": "install.sh"
  }
}
`
	if string(content) != expected {
		t.Fatalf("manifest:\n%s", content)
	}
	if err := WriteManifest(destination, "1.2.3", "nightly"); err == nil {
		t.Fatal("expected invalid release channel")
	}
}
