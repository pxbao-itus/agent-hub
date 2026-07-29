package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-hub-cli/internal/target"
)

func TestLoadMissingReturnsV2Manifest(t *testing.T) {
	m, err := Load(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if m.SchemaVersion != SchemaVersion || len(m.Skills) != 0 {
		t.Fatalf("unexpected empty manifest: %+v", m)
	}
}

func TestLoadV1MigratesSkillToClaude(t *testing.T) {
	dir := t.TempDir()
	legacy := `{
  "skills": {"org.team.review": {"versionNo": 3, "contentHash": "old-hash"}},
  "kits": {"legacy-kit": {"versionNo": 2, "contentHash": "kit-hash"}},
  "commands": {"legacy-command": {"versionNo": 1, "contentHash": "command-hash"}}
}`
	if err := os.WriteFile(filepath.Join(dir, filename), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := m.Get("org.team.review", target.Claude)
	if !ok || got.InstallName != "org.team.review" || got.RendererVersion != 0 || got.ContentHash != "old-hash" {
		t.Fatalf("legacy install = %+v, %v", got, ok)
	}
	if len(m.LegacyKits) != 1 {
		t.Fatalf("legacy kits = %d", len(m.LegacyKits))
	}
}

func TestManifestTracksSameSkillForBothTargets(t *testing.T) {
	dir := t.TempDir()
	m := empty()
	m.Set("org.review", target.Claude, Installation{InstallName: "review", VersionNo: 1, ContentHash: "c"})
	m.Set("org.review", target.Codex, Installation{InstallName: "review", VersionNo: 1, ContentHash: "x"})
	if err := Save(m, dir); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := loaded.Get("org.review", target.Claude); !ok {
		t.Fatal("Claude installation missing")
	}
	if _, ok := loaded.Get("org.review", target.Codex); !ok {
		t.Fatal("Codex installation missing")
	}
}

func TestSaveDropsLegacyKitsWithoutTouchingLocalFile(t *testing.T) {
	dir := t.TempDir()
	localFile := filepath.Join(dir, ".claude", "skills", "legacy", "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(localFile), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(localFile, []byte("local content"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(dir, filename),
		[]byte(`{"skills":{},"kits":{"old":{"versionNo":1,"contentHash":"x"}},"commands":{}}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	m, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := Save(m, dir); err != nil {
		t.Fatal(err)
	}
	saved, _ := os.ReadFile(filepath.Join(dir, filename))
	if strings.Contains(string(saved), `"kits"`) {
		t.Fatalf("saved manifest still contains kits: %s", saved)
	}
	content, err := os.ReadFile(localFile)
	if err != nil || string(content) != "local content" {
		t.Fatalf("local file changed: %q, %v", content, err)
	}
}

func TestMalformedManifestReturnsError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, filename), []byte("{"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(dir); err == nil {
		t.Fatal("expected malformed manifest error")
	}
}
