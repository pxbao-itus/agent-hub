package target

import (
	"path/filepath"
	"testing"
)

func TestParseDefaultsToClaude(t *testing.T) {
	got, err := Parse("")
	if err != nil || got != Claude {
		t.Fatalf("Parse(\"\") = %q, %v; want claude", got, err)
	}
}

func TestProjectRootsAndHints(t *testing.T) {
	root := t.TempDir()
	if got := Claude.ProjectSkillRoot(root); got != filepath.Join(root, ".claude", "skills") {
		t.Fatalf("Claude root = %q", got)
	}
	if got := Codex.ProjectSkillRoot(root); got != filepath.Join(root, ".agents", "skills") {
		t.Fatalf("Codex root = %q", got)
	}
	if got := Claude.InvocationHint("review"); got != "/review" {
		t.Fatalf("Claude hint = %q", got)
	}
	if got := Codex.InvocationHint("review"); got != "$review (or select it with /skills)" {
		t.Fatalf("Codex hint = %q", got)
	}
}

func TestParseRejectsUnknownTarget(t *testing.T) {
	if _, err := Parse("cursor"); err == nil {
		t.Fatal("expected unsupported target error")
	}
}
