package commands

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/target"
)

func cleanFixture(t *testing.T) (string, *manifest.Manifest) {
	t.Helper()
	dir := t.TempDir()
	m, err := manifest.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, targetName := range []target.Name{target.Claude, target.Codex} {
		installName := "agenthub-review"
		path := filepath.Join(targetName.ProjectSkillRoot(dir), installName)
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "SKILL.md"), []byte("managed"), 0o644); err != nil {
			t.Fatal(err)
		}
		m.Set("org.team.review", targetName, manifest.Installation{
			InstallName: installName,
			VersionNo:   1,
			ContentHash: "hash",
		})
	}
	untracked := filepath.Join(target.Claude.ProjectSkillRoot(dir), "local-only")
	if err := os.MkdirAll(untracked, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(untracked, "SKILL.md"), []byte("local"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manifest.Save(m, dir); err != nil {
		t.Fatal(err)
	}
	return dir, m
}

func TestCleanConfirmationCanCancel(t *testing.T) {
	dir, _ := cleanFixture(t)
	var output bytes.Buffer
	if err := cleanProject(nil, strings.NewReader("n\n"), &output, dir, true); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Clean cancelled.") {
		t.Fatalf("output:\n%s", output.String())
	}
	if _, err := os.Stat(filepath.Join(target.Claude.ProjectSkillRoot(dir), "agenthub-review")); err != nil {
		t.Fatal("managed Skill was removed after cancellation")
	}
}

func TestCleanTargetRemovesOnlySelectedInstallations(t *testing.T) {
	dir, _ := cleanFixture(t)
	var output bytes.Buffer
	if err := cleanProject([]string{"--target", "claude", "--yes"}, nil, &output, dir, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target.Claude.ProjectSkillRoot(dir), "agenthub-review")); !os.IsNotExist(err) {
		t.Fatal("Claude Skill was not removed")
	}
	if _, err := os.Stat(filepath.Join(target.Codex.ProjectSkillRoot(dir), "agenthub-review")); err != nil {
		t.Fatal("Codex Skill was removed")
	}
	loaded, err := manifest.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := loaded.Get("org.team.review", target.Claude); ok {
		t.Fatal("Claude lock entry remains")
	}
	if _, ok := loaded.Get("org.team.review", target.Codex); !ok {
		t.Fatal("Codex lock entry was removed")
	}
}

func TestCleanAllPreservesUntrackedSkillAndRemovesEmptyLock(t *testing.T) {
	dir, _ := cleanFixture(t)
	var output bytes.Buffer
	if err := cleanProject([]string{"--yes"}, nil, &output, dir, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".agent-hub-lock.json")); !os.IsNotExist(err) {
		t.Fatal("empty lockfile was not removed")
	}
	if _, err := os.Stat(filepath.Join(target.Claude.ProjectSkillRoot(dir), "local-only", "SKILL.md")); err != nil {
		t.Fatal("untracked Skill was removed")
	}
	if !strings.Contains(output.String(), "Removed 2 managed Skill installation(s).") {
		t.Fatalf("output:\n%s", output.String())
	}
}

func TestCleanDryRunAndNonInteractiveGuard(t *testing.T) {
	dir, _ := cleanFixture(t)
	var output bytes.Buffer
	if err := cleanProject([]string{"--dry-run"}, nil, &output, dir, false); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "[dry-run]") {
		t.Fatalf("output:\n%s", output.String())
	}
	if err := cleanProject(nil, nil, &output, dir, false); err == nil ||
		!strings.Contains(err.Error(), "--yes") {
		t.Fatalf("non-interactive error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(target.Claude.ProjectSkillRoot(dir), "agenthub-review")); err != nil {
		t.Fatal("dry-run removed a managed Skill")
	}
}

func TestCleanGlobalUsesHomeAndPreservesProjectScope(t *testing.T) {
	projectDir, _ := cleanFixture(t)
	homeDir, _ := cleanFixture(t)
	t.Setenv("HOME", homeDir)

	var output bytes.Buffer
	if err := cleanProject([]string{"--global", "--target", "claude", "--yes"}, nil, &output, projectDir, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target.Claude.ProjectSkillRoot(homeDir), "agenthub-review")); !os.IsNotExist(err) {
		t.Fatal("global Claude Skill was not removed")
	}
	if _, err := os.Stat(filepath.Join(target.Claude.ProjectSkillRoot(projectDir), "agenthub-review")); err != nil {
		t.Fatal("project Claude Skill was modified by global clean")
	}
	globalManifest, err := manifest.Load(homeDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := globalManifest.Get("org.team.review", target.Claude); ok {
		t.Fatal("global Claude lock entry remains")
	}
	projectManifest, err := manifest.Load(projectDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := projectManifest.Get("org.team.review", target.Claude); !ok {
		t.Fatal("project Claude lock entry was removed")
	}
}
