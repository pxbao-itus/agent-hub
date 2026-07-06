package fsio

import (
	"testing"

	"agent-hub-cli/internal/mcp"
)

func makeBundle(files []mcp.FileEntry) mcp.SkillBundle {
	if files == nil {
		files = []mcp.FileEntry{{Path: "checklist.md", Content: "- [ ] item"}}
	}
	return mcp.SkillBundle{
		SchemaVersion: 1,
		Kind:          "skill",
		Slug:          "test-skill",
		Title:         "Test skill",
		Body:          "# Test skill\n",
		Files:         files,
		VersionNo:     1,
		UpdatedAt:     "2026-01-01T00:00:00.000Z",
	}
}

func TestWriteSkillRoundTrip(t *testing.T) {
	dir := t.TempDir()
	bundle := makeBundle(nil)
	if _, err := WriteSkill(bundle, dir); err != nil {
		t.Fatalf("WriteSkill: %v", err)
	}

	disk, err := ReadSkillFromDisk(bundle.Slug, dir)
	if err != nil {
		t.Fatalf("ReadSkillFromDisk: %v", err)
	}
	if disk == nil {
		t.Fatal("expected disk skill, got nil")
	}
	if disk.Body != bundle.Body {
		t.Errorf("body mismatch: got %q, want %q", disk.Body, bundle.Body)
	}
	if len(disk.Files) != 1 || disk.Files[0].Path != "checklist.md" || disk.Files[0].Content != "- [ ] item" {
		t.Errorf("files mismatch: got %+v", disk.Files)
	}
}

func TestWriteSkillNestedFilePath(t *testing.T) {
	dir := t.TempDir()
	bundle := makeBundle([]mcp.FileEntry{{Path: "scripts/run.sh", Content: "echo hi"}})
	if _, err := WriteSkill(bundle, dir); err != nil {
		t.Fatalf("WriteSkill: %v", err)
	}

	disk, err := ReadSkillFromDisk(bundle.Slug, dir)
	if err != nil {
		t.Fatalf("ReadSkillFromDisk: %v", err)
	}
	if len(disk.Files) != 1 || disk.Files[0].Path != "scripts/run.sh" || disk.Files[0].Content != "echo hi" {
		t.Errorf("nested file mismatch: got %+v", disk.Files)
	}
}

func TestReadSkillFromDiskNeverPulled(t *testing.T) {
	dir := t.TempDir()
	disk, err := ReadSkillFromDisk("never-pulled", dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if disk != nil {
		t.Errorf("expected nil for a skill never pulled, got %+v", disk)
	}
}

func TestWriteSkillRefusesPathEscape(t *testing.T) {
	dir := t.TempDir()
	bundle := makeBundle([]mcp.FileEntry{{Path: "../../etc/passwd", Content: "pwned"}})
	_, err := WriteSkill(bundle, dir)
	if err == nil {
		t.Fatal("expected an error for a path that escapes the skill directory")
	}
}

func TestWriteSkillRefusesAbsolutePath(t *testing.T) {
	dir := t.TempDir()
	bundle := makeBundle([]mcp.FileEntry{{Path: "/etc/passwd", Content: "pwned"}})
	_, err := WriteSkill(bundle, dir)
	if err == nil {
		t.Fatal("expected an error for an absolute path")
	}
}

func TestAssertSafeRelativePath(t *testing.T) {
	cases := []struct {
		path    string
		wantErr bool
	}{
		{"checklist.md", false},
		{"scripts/run.sh", false},
		{"../escape.md", true},
		{"a/../../escape.md", true},
		{"/etc/passwd", true},
		{"..", true},
	}
	for _, c := range cases {
		err := AssertSafeRelativePath(c.path)
		if c.wantErr && err == nil {
			t.Errorf("AssertSafeRelativePath(%q): expected error, got nil", c.path)
		}
		if !c.wantErr && err != nil {
			t.Errorf("AssertSafeRelativePath(%q): unexpected error: %v", c.path, err)
		}
	}
}
