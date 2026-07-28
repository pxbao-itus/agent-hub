package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadLegacyKitsAndSaveDropsOnlyTracking(t *testing.T) {
	dir := t.TempDir()
	lockPath := filepath.Join(dir, filename)
	localFile := filepath.Join(dir, ".claude", "skills", "legacy", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(localFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(localFile, []byte("local content"), 0o644); err != nil {
		t.Fatal(err)
	}
	legacy := `{
  "skills": {"direct": {"versionNo": 1, "contentHash": "skill-hash"}},
  "kits": {"legacy-kit": {"versionNo": 2, "contentHash": "kit-hash"}},
  "commands": {"legacy-command": {"versionNo": 1, "contentHash": "command-hash"}}
}`
	if err := os.WriteFile(lockPath, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}

	m := Load(dir)
	if len(m.LegacyKits) != 1 {
		t.Fatalf("legacy kits: got %d, want 1", len(m.LegacyKits))
	}
	if err := Save(m, dir); err != nil {
		t.Fatal(err)
	}

	saved, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(saved), `"kits"`) {
		t.Fatalf("saved manifest still contains Kit tracking: %s", saved)
	}
	content, err := os.ReadFile(localFile)
	if err != nil {
		t.Fatalf("legacy local file was removed: %v", err)
	}
	if string(content) != "local content" {
		t.Fatalf("legacy local file changed: %q", content)
	}
}

func TestLoadWithoutKitsUsesEmptyLegacyMap(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(dir, filename),
		[]byte(`{"skills":{},"commands":{}}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	m := Load(dir)
	if len(m.LegacyKits) != 0 {
		t.Fatalf("legacy kits: got %d, want 0", len(m.LegacyKits))
	}
}
