package fsio

import (
	"os"
	"path/filepath"
	"testing"

	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/target"
)

func TestReplaceSkillRoundTripAndStaleRemoval(t *testing.T) {
	dir := t.TempDir()
	files := []mcp.FileEntry{{Path: "scripts/run.sh", Content: "echo one"}}
	managed, path, err := ReplaceSkill(dir, target.Claude, "review", "body one", files)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dir, ".claude", "skills", "review") || len(managed) != 2 {
		t.Fatalf("path=%q managed=%v", path, managed)
	}
	disk, err := ReadSkillFromDisk(dir, target.Claude, "review")
	if err != nil || disk.Body != "body one" || len(disk.Files) != 1 {
		t.Fatalf("disk=%+v err=%v", disk, err)
	}
	if _, _, err := ReplaceSkill(dir, target.Claude, "review", "body two", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(path, "scripts", "run.sh")); !os.IsNotExist(err) {
		t.Fatalf("stale file still exists: %v", err)
	}
}

func TestTargetIsolation(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := ReplaceSkill(dir, target.Claude, "review", "claude", nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReplaceSkill(dir, target.Codex, "review", "codex", nil); err != nil {
		t.Fatal(err)
	}
	claude, _ := ReadSkillFromDisk(dir, target.Claude, "review")
	codex, _ := ReadSkillFromDisk(dir, target.Codex, "review")
	if claude.Body != "claude" || codex.Body != "codex" {
		t.Fatalf("claude=%+v codex=%+v", claude, codex)
	}
}

func TestValidateBundleFiles(t *testing.T) {
	cases := []struct {
		name  string
		files []mcp.FileEntry
	}{
		{"escape", []mcp.FileEntry{{Path: "../escape", Content: "x"}}},
		{"absolute", []mcp.FileEntry{{Path: "/tmp/x", Content: "x"}}},
		{"reserved", []mcp.FileEntry{{Path: "SKILL.md", Content: "x"}}},
		{"duplicate", []mcp.FileEntry{{Path: "A.md"}, {Path: "a.md"}}},
		{"prefix", []mcp.FileEntry{{Path: "scripts"}, {Path: "scripts/run.sh"}}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateBundleFiles(test.files); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestUnmanagedSymlinkIsRejected(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	root := filepath.Join(dir, ".claude", "skills")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "review")); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadSkillFromDisk(dir, target.Claude, "review"); err == nil {
		t.Fatal("expected symlink rejection")
	}
}

func TestRemoveManagedSkillOnlySelectedTarget(t *testing.T) {
	dir := t.TempDir()
	_, _, _ = ReplaceSkill(dir, target.Claude, "review", "claude", nil)
	_, _, _ = ReplaceSkill(dir, target.Codex, "review", "codex", nil)
	if err := RemoveManagedSkill(dir, target.Claude, "review"); err != nil {
		t.Fatal(err)
	}
	if exists, _ := Exists(dir, target.Claude, "review"); exists {
		t.Fatal("Claude skill was not removed")
	}
	if exists, _ := Exists(dir, target.Codex, "review"); !exists {
		t.Fatal("Codex skill was unexpectedly removed")
	}
}

func TestTransactionRollbackRestoresSkillsAndManifest(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := ReplaceSkill(dir, target.Claude, "review", "old body", nil); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(dir, manifestFilename)
	if err := os.WriteFile(manifestPath, []byte("old manifest"), 0o644); err != nil {
		t.Fatal(err)
	}
	transaction, err := BeginTransaction(dir, target.Claude, []string{"review", "new-skill"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReplaceSkill(dir, target.Claude, "review", "new body", nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReplaceSkill(dir, target.Claude, "new-skill", "created", nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(manifestPath, []byte("new manifest"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := transaction.Rollback(); err != nil {
		t.Fatal(err)
	}

	review, err := ReadSkillFromDisk(dir, target.Claude, "review")
	if err != nil || review == nil || review.Body != "old body" {
		t.Fatalf("review=%+v err=%v", review, err)
	}
	if exists, _ := Exists(dir, target.Claude, "new-skill"); exists {
		t.Fatal("new Skill survived rollback")
	}
	content, err := os.ReadFile(manifestPath)
	if err != nil || string(content) != "old manifest" {
		t.Fatalf("manifest=%q err=%v", content, err)
	}
	if _, err := os.Stat(filepath.Join(dir, transactionJournal)); !os.IsNotExist(err) {
		t.Fatalf("journal survived rollback: %v", err)
	}
}

func TestRecoverPendingTransactionAfterInterruptedApply(t *testing.T) {
	dir := t.TempDir()
	if _, _, err := ReplaceSkill(dir, target.Codex, "review", "before", nil); err != nil {
		t.Fatal(err)
	}
	_, err := BeginTransaction(dir, target.Codex, []string{"review"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReplaceSkill(dir, target.Codex, "review", "interrupted", nil); err != nil {
		t.Fatal(err)
	}
	// Simulate losing the in-memory handle while the durable journal remains.
	if err := RecoverPending(dir); err != nil {
		t.Fatal(err)
	}
	review, err := ReadSkillFromDisk(dir, target.Codex, "review")
	if err != nil || review == nil || review.Body != "before" {
		t.Fatalf("review=%+v err=%v", review, err)
	}
}
