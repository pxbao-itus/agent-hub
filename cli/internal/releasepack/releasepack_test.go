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
	if got != "agent-hub_1.2.3_darwin_arm64.tar.gz" {
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
	binary := filepath.Join(dir, "agent-hub")
	readme := filepath.Join(dir, "README.md")
	if err := os.WriteFile(binary, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readme, []byte("readme"), 0o644); err != nil {
		t.Fatal(err)
	}
	files := []InputFile{
		{Source: readme, Name: "README.md", Mode: 0o644},
		{Source: binary, Name: "agent-hub", Mode: 0o755},
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
	if strings.Join(names, ",") != "README.md,agent-hub" {
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
	content := "version=__CLI_VERSION__\nbase=__CLI_RELEASE_BASE_URL__\n"
	if err := os.WriteFile(template, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	base := "https://github.com/example/agent-hub/releases/download/cli-v1.2.3"
	if err := RenderInstaller(template, destination, "1.2.3", base); err != nil {
		t.Fatal(err)
	}
	rendered, _ := os.ReadFile(destination)
	if string(rendered) != "version=1.2.3\nbase="+base+"\n" {
		t.Fatalf("rendered installer:\n%s", rendered)
	}
	info, _ := os.Stat(destination)
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("installer mode = %o", info.Mode().Perm())
	}

	for _, invalid := range []string{
		"http://example.com/download/cli-v1.2.3",
		"https://example.com/download/latest",
		"https://user@example.com/download/cli-v1.2.3",
		"https://example.com/$(touch-pwned)/cli-v1.2.3",
	} {
		if err := RenderInstaller(template, destination, "1.2.3", invalid); err == nil {
			t.Fatalf("expected invalid base URL %q", invalid)
		}
	}
}
