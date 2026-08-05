package commands

import (
	"testing"

	"agent-hub-cli/internal/target"
)

func TestParsePullDefaultsToClaude(t *testing.T) {
	opts, err := parsePull([]string{"skill", "org.team.review"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.target != target.Claude || opts.slug != "org.team.review" || opts.all || opts.global {
		t.Fatalf("options = %+v", opts)
	}
}

func TestParsePullAllCodexGlobalDryRun(t *testing.T) {
	opts, err := parsePull([]string{"skill", "--all", "--target", "codex", "--global", "--dry-run"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.target != target.Codex || !opts.all || !opts.global || !opts.dryRun {
		t.Fatalf("options = %+v", opts)
	}
}

func TestParsePullAlias(t *testing.T) {
	opts, err := parsePull([]string{"skill", "org.review", "--as", "backend-review"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.alias != "backend-review" {
		t.Fatalf("alias = %q", opts.alias)
	}
}

func TestParsePullRejectsAmbiguousInputs(t *testing.T) {
	cases := [][]string{
		{"skill"},
		{"skill", "--all", "org.review"},
		{"skill", "--all", "--as", "review"},
		{"skill", "one", "two"},
		{"skill", "one", "--target", "cursor"},
	}
	for _, args := range cases {
		if _, err := parsePull(args); err == nil {
			t.Fatalf("expected error for %v", args)
		}
	}
}

func TestParseSyncTargetAndGlobalScope(t *testing.T) {
	opts, err := parseSyncOptions([]string{"--target=codex", "--global", "--dry-run"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.target != target.Codex || !opts.global || !opts.dryRun {
		t.Fatalf("options = %+v", opts)
	}
}

func TestParseCleanGlobalScope(t *testing.T) {
	opts, err := parseCleanOptions([]string{"--global", "--target=claude", "--yes"})
	if err != nil {
		t.Fatal(err)
	}
	if !opts.global || opts.target == nil || *opts.target != target.Claude || !opts.yes {
		t.Fatalf("options = %+v", opts)
	}
}
