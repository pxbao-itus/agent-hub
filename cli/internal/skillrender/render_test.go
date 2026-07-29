package skillrender

import (
	"strings"
	"testing"

	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/target"
)

func bundle(body string) mcp.SkillBundle {
	description := "Review changes safely"
	return mcp.SkillBundle{
		Slug:        "acme.backend.pr-review",
		Title:       "PR review",
		Description: &description,
		Body:        body,
	}
}

func TestRenderAddsNativeFrontmatter(t *testing.T) {
	got, err := Render(bundle("# Review\n"), "pr-review", target.Claude)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"name: pr-review", `description: "Review changes safely"`, "# Review"} {
		if !strings.Contains(got, want) {
			t.Fatalf("rendered body missing %q:\n%s", want, got)
		}
	}
}

func TestRenderPreservesCustomFrontmatter(t *testing.T) {
	got, err := Render(bundle("---\nallowed-tools: Bash(git diff *)\n---\n\nDo it."), "review", target.Claude)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"allowed-tools: Bash(git diff *)", "name: review", "description:", "Do it."} {
		if !strings.Contains(got, want) {
			t.Fatalf("rendered body missing %q:\n%s", want, got)
		}
	}
}

func TestResolveInstallNamePriority(t *testing.T) {
	withName := bundle("---\nname: author-name\ndescription: x\n---\nbody")
	if got, _ := ResolveInstallName(withName, "explicit-name"); got != "explicit-name" {
		t.Fatalf("explicit alias = %q", got)
	}
	if got, _ := ResolveInstallName(withName, ""); got != "agenthub-pr-review" {
		t.Fatalf("default prefixed name = %q", got)
	}
	if got, _ := ResolveLegacyInstallName(withName); got != "author-name" {
		t.Fatalf("legacy frontmatter name = %q", got)
	}
	if got, _ := ResolveLegacyInstallName(bundle("body")); got != "pr-review" {
		t.Fatalf("legacy local slug = %q", got)
	}
}

func TestMalformedAndDuplicateFrontmatterRejected(t *testing.T) {
	for _, body := range []string{
		"---\nname: broken",
		"---\nname: one\nname: two\n---\nbody",
		"---\ndescription: one\ndescription: two\n---\nbody",
	} {
		if _, err := Render(bundle(body), "review", target.Claude); err == nil {
			t.Fatalf("expected error for %q", body)
		}
	}
}

func TestValidateName(t *testing.T) {
	for _, name := range []string{"review", "review-2", "a"} {
		if err := ValidateName(name); err != nil {
			t.Errorf("ValidateName(%q): %v", name, err)
		}
	}
	for _, name := range []string{"Review", "has.dot", "-bad", "bad-", ""} {
		if err := ValidateName(name); err == nil {
			t.Errorf("ValidateName(%q): expected error", name)
		}
	}
}
