package syncengine

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/target"
)

func newClient(t *testing.T, bundles map[string]mcp.SkillBundle) *mcp.Client {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Params struct {
				Name      string            `json:"name"`
				Arguments map[string]string `json:"arguments"`
			} `json:"params"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		var text string
		switch request.Params.Name {
		case "list_skills":
			var lines []string
			for slug := range bundles {
				lines = append(lines, "- "+slug+": test")
			}
			text = strings.Join(lines, "\n")
			if text == "" {
				text = "No skills available."
			}
		case "pull_skill":
			bundle, ok := bundles[request.Params.Arguments["slug"]]
			if !ok {
				text = `{"error":"not found"}`
			} else {
				data, _ := json.Marshal(bundle)
				text = string(data)
			}
		default:
			t.Fatalf("unexpected tool %s", request.Params.Name)
		}
		rpc, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"result": map[string]any{
				"content": []map[string]string{{"type": "text", "text": text}},
			},
		})
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n", rpc)
	}))
	t.Cleanup(server.Close)
	return mcp.NewClient(config.Config{BaseURL: server.URL, Token: "test"})
}

func testBundle(slug, body string, version int) mcp.SkillBundle {
	description := "A test Skill"
	return mcp.SkillBundle{
		SchemaVersion: 1,
		Kind:          "skill",
		Slug:          slug,
		Title:         "Test Skill",
		Description:   &description,
		Body:          body,
		VersionNo:     version,
	}
}

func TestInstallOneTargetsAndAuthoritativeOverwrite(t *testing.T) {
	dir := t.TempDir()
	m, _ := manifest.Load(dir)
	bundle := testBundle("org.team.review", "# Review\n", 1)

	claudeResult, err := InstallOne(bundle, target.Claude, "", m, dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if claudeResult.Action != ActionInstall || claudeResult.InstallName != "review" {
		t.Fatalf("Claude result = %+v", claudeResult)
	}
	if _, err := InstallOne(bundle, target.Codex, "", m, dir, true); err != nil {
		t.Fatal(err)
	}
	claudePath := filepath.Join(dir, ".claude", "skills", "review", "SKILL.md")
	codexPath := filepath.Join(dir, ".agents", "skills", "review", "SKILL.md")
	if _, err := os.Stat(claudePath); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(codexPath); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(claudePath, []byte("local edit"), 0o644); err != nil {
		t.Fatal(err)
	}
	overwrite, err := InstallOne(bundle, target.Claude, "", m, dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if overwrite.Action != ActionOverwriteLocal {
		t.Fatalf("action = %s", overwrite.Action)
	}
	content, _ := os.ReadFile(claudePath)
	if strings.Contains(string(content), "local edit") || !strings.Contains(string(content), "name: review") {
		t.Fatalf("managed local edit was not overwritten:\n%s", content)
	}
}

func TestReconcileSnapshotIncludesNewAndPrunesInaccessible(t *testing.T) {
	dir := t.TempDir()
	m, _ := manifest.Load(dir)
	first := testBundle("org.one", "one", 1)
	second := testBundle("org.two", "two", 1)
	client := newClient(t, map[string]mcp.SkillBundle{
		first.Slug:  first,
		second.Slug: second,
	})
	slugs, err := client.ListSkills()
	if err != nil {
		t.Fatal(err)
	}
	results, err := ReconcileSnapshot(client, slugs, target.Claude, m, dir, true, true)
	if err != nil || len(results) != 2 {
		t.Fatalf("results=%+v err=%v", results, err)
	}

	client = newClient(t, map[string]mcp.SkillBundle{second.Slug: second})
	slugs, _ = client.ListSkills()
	results, err = ReconcileSnapshot(client, slugs, target.Claude, m, dir, false, true)
	if err != nil {
		t.Fatal(err)
	}
	foundRemove := false
	for _, result := range results {
		if result.RemoteSlug == first.Slug && result.Action == ActionRemove {
			foundRemove = true
		}
	}
	if !foundRemove {
		t.Fatalf("missing remove result: %+v", results)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude", "skills", "one")); !os.IsNotExist(err) {
		t.Fatal("inaccessible Skill was not removed")
	}
}

func TestSelectedSyncDoesNotInstallNewAccessibleSkill(t *testing.T) {
	dir := t.TempDir()
	m, _ := manifest.Load(dir)
	one := testBundle("org.one", "one", 1)
	two := testBundle("org.two", "two", 1)
	if _, err := InstallOne(one, target.Claude, "", m, dir, true); err != nil {
		t.Fatal(err)
	}
	client := newClient(t, map[string]mcp.SkillBundle{one.Slug: one, two.Slug: two})
	slugs, _ := client.ListSkills()
	if _, err := ReconcileSnapshot(client, slugs, target.Claude, m, dir, false, true); err != nil {
		t.Fatal(err)
	}
	if _, ok := m.Get(two.Slug, target.Claude); ok {
		t.Fatal("selected sync installed a newly accessible untracked Skill")
	}
}

func TestUntrackedDestinationIsProtected(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".claude", "skills", "review")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "SKILL.md"), []byte("manual"), 0o644); err != nil {
		t.Fatal(err)
	}
	m, _ := manifest.Load(dir)
	if _, err := InstallOne(testBundle("org.review", "remote", 1), target.Claude, "", m, dir, true); err == nil {
		t.Fatal("expected untracked destination error")
	}
	content, _ := os.ReadFile(filepath.Join(path, "SKILL.md"))
	if string(content) != "manual" {
		t.Fatal("untracked Skill was modified")
	}
}

func TestDryRunDoesNotWrite(t *testing.T) {
	dir := t.TempDir()
	m, _ := manifest.Load(dir)
	if _, err := InstallOne(testBundle("org.review", "remote", 1), target.Claude, "", m, dir, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude")); !os.IsNotExist(err) {
		t.Fatal("dry run wrote target root")
	}
	if len(m.Skills) != 0 {
		t.Fatal("dry run changed manifest")
	}
}
