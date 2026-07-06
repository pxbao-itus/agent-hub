package syncengine

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
)

// newTestServer returns an httptest server that answers every tools/call
// request with the given bundle (JSON-marshaled), framed as the SSE
// response body internal/mcp's parseSSE expects.
func newTestServer(t *testing.T, bundle any) (*httptest.Server, *mcp.Client) {
	t.Helper()
	payload, err := json.Marshal(bundle)
	if err != nil {
		t.Fatalf("marshal bundle: %v", err)
	}
	rpcBody, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"result": map[string]any{
			"content": []map[string]string{{"type": "text", "text": string(payload)}},
		},
	})
	if err != nil {
		t.Fatalf("marshal rpc envelope: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n", rpcBody)
	}))
	t.Cleanup(server.Close)

	client := mcp.NewClient(config.Config{BaseURL: server.URL, Token: "test-token"})
	return server, client
}

func TestReconcileTrackedSkillUpToDate(t *testing.T) {
	dir := t.TempDir()
	bundle := mcp.SkillBundle{Slug: "s1", Body: "body v1", Files: nil, VersionNo: 1}
	_, client := newTestServer(t, bundle)

	m := manifest.Load(dir)
	// First reconcile: nothing on disk yet -> "update", writes the skill.
	first, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if first.Action != ActionUpdate {
		t.Fatalf("first reconcile: got %q, want update", first.Action)
	}

	// Second reconcile against the same unchanged bundle: disk now matches
	// the manifest's last-known hash -> up-to-date.
	second, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if second.Action != ActionUpToDate {
		t.Fatalf("second reconcile: got %q, want up-to-date", second.Action)
	}
}

func TestReconcileTrackedSkillLocalOnly(t *testing.T) {
	dir := t.TempDir()
	bundle := mcp.SkillBundle{Slug: "s1", Body: "body v1", Files: nil, VersionNo: 1}
	_, client := newTestServer(t, bundle)

	m := manifest.Load(dir)
	if _, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	// Simulate a local edit — disk now differs from the manifest's last-known hash.
	skillMd := filepath.Join(dir, ".claude", "skills", "s1", "SKILL.md")
	if err := os.WriteFile(skillMd, []byte("locally edited"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	result, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if result.Action != ActionLocalOnly {
		t.Fatalf("got %q, want local-only", result.Action)
	}
	content, _ := os.ReadFile(skillMd)
	if string(content) != "locally edited" {
		t.Error("local-only edit should not be overwritten")
	}
}

func TestReconcileTrackedSkillConflictRequiresForce(t *testing.T) {
	dir := t.TempDir()
	bundle := mcp.SkillBundle{Slug: "s1", Body: "body v1", Files: nil, VersionNo: 1}
	server, client := newTestServer(t, bundle)

	m := manifest.Load(dir)
	if _, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	// Local edit AND a new server version -> conflict.
	skillMd := filepath.Join(dir, ".claude", "skills", "s1", "SKILL.md")
	if err := os.WriteFile(skillMd, []byte("locally edited"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	server.Close()
	bundle.Body = "body v2"
	bundle.VersionNo = 2
	_, client = newTestServer(t, bundle)

	withoutForce, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true, Force: false}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if withoutForce.Action != ActionConflict {
		t.Fatalf("got %q, want conflict", withoutForce.Action)
	}
	content, _ := os.ReadFile(skillMd)
	if string(content) != "locally edited" {
		t.Error("conflict without --force should not overwrite the local edit")
	}

	withForce, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true, Force: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if withForce.Action != ActionConflict {
		t.Fatalf("got %q, want conflict", withForce.Action)
	}
	content, _ = os.ReadFile(skillMd)
	if string(content) != "body v2" {
		t.Error("conflict with --force should overwrite the local edit")
	}
}

func TestReconcileTrackedSkillRemovesStaleFiles(t *testing.T) {
	dir := t.TempDir()
	bundle := mcp.SkillBundle{
		Slug:      "s1",
		Body:      "body",
		Files:     []mcp.FileEntry{{Path: "keep.md", Content: "keep"}, {Path: "drop.md", Content: "drop"}},
		VersionNo: 1,
	}
	server, client := newTestServer(t, bundle)
	m := manifest.Load(dir)
	if _, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir); err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	dropPath := filepath.Join(dir, ".claude", "skills", "s1", "drop.md")
	if _, err := os.Stat(dropPath); err != nil {
		t.Fatalf("expected drop.md to exist after first pull: %v", err)
	}

	// Server drops drop.md from the next version of the bundle.
	server.Close()
	bundle.Files = []mcp.FileEntry{{Path: "keep.md", Content: "keep"}}
	bundle.VersionNo = 2
	_, client = newTestServer(t, bundle)

	result, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if result.Action != ActionUpdate {
		t.Fatalf("got %q, want update", result.Action)
	}
	if _, err := os.Stat(dropPath); !os.IsNotExist(err) {
		t.Errorf("expected drop.md to be removed as stale, stat err: %v", err)
	}
	keepPath := filepath.Join(dir, ".claude", "skills", "s1", "keep.md")
	if _, err := os.Stat(keepPath); err != nil {
		t.Errorf("expected keep.md to remain: %v", err)
	}
}

func TestReconcileTrackedKitReconcilesMembersAndKitItself(t *testing.T) {
	dir := t.TempDir()
	bundle := mcp.KitBundle{
		Slug:      "k1",
		Body:      "kit body",
		VersionNo: 1,
		Skills:    []mcp.SkillBundle{{Slug: "member-skill", Body: "skill body", VersionNo: 1}},
		Prompts:   []mcp.PromptEntry{{Slug: "member-prompt", Body: "prompt body", VersionNo: 1}},
	}
	_, client := newTestServer(t, bundle)

	m := manifest.Load(dir)
	first, err := ReconcileTrackedKit(client, "k1", m, SyncOptions{Apply: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if first.Kit.Action != ActionUpdate {
		t.Fatalf("kit action: got %q, want update", first.Kit.Action)
	}
	if len(first.Members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(first.Members))
	}
	for _, member := range first.Members {
		if member.Action != ActionUpdate {
			t.Errorf("member %s: got %q, want update", member.Slug, member.Action)
		}
	}

	skillMd := filepath.Join(dir, ".claude", "skills", "member-skill", "SKILL.md")
	if _, err := os.Stat(skillMd); err != nil {
		t.Errorf("expected member skill written to disk: %v", err)
	}
	commandMd := filepath.Join(dir, ".claude", "commands", "member-prompt.md")
	if _, err := os.Stat(commandMd); err != nil {
		t.Errorf("expected member prompt written as a command: %v", err)
	}

	second, err := ReconcileTrackedKit(client, "k1", m, SyncOptions{Apply: true}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if second.Kit.Action != ActionUpToDate {
		t.Fatalf("kit action on 2nd reconcile: got %q, want up-to-date", second.Kit.Action)
	}
}

func TestReconcileTrackedSkillDryRunDoesNotWrite(t *testing.T) {
	dir := t.TempDir()
	bundle := mcp.SkillBundle{Slug: "s1", Body: "body", VersionNo: 1}
	_, client := newTestServer(t, bundle)

	m := manifest.Load(dir)
	result, err := ReconcileTrackedSkill(client, "s1", m, SyncOptions{Apply: false}, dir)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if result.Action != ActionUpdate {
		t.Fatalf("got %q, want update", result.Action)
	}
	if _, err := os.Stat(filepath.Join(dir, ".claude")); !os.IsNotExist(err) {
		t.Error("status (apply=false) must not write anything to disk")
	}
	if len(m.Skills) != 0 {
		t.Error("status (apply=false) must not update the manifest")
	}
}
