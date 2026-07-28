package commands

import (
	"fmt"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/syncengine"
)

func describeStatus(r syncengine.SyncResult) string {
	switch r.Action {
	case syncengine.ActionUpToDate:
		return fmt.Sprintf("%s: up to date (v%d)", r.Slug, r.VersionNo)
	case syncengine.ActionUpdate:
		return fmt.Sprintf("%s: server has v%d (not yet pulled — run `agent-hub sync`)", r.Slug, r.VersionNo)
	case syncengine.ActionLocalOnly:
		return fmt.Sprintf("%s: local changes, server unchanged", r.Slug)
	case syncengine.ActionConflict:
		return fmt.Sprintf("%s: CONFLICT — local edits AND server v%d both changed", r.Slug, r.VersionNo)
	}
	return fmt.Sprintf("%s: unknown action %q", r.Slug, r.Action)
}

// Status is a read-only dry run of sync's diff logic — writes nothing
// (plans/42-cli-filesystem-sync.md §7, carried over 1:1 in the Go rewrite).
func Status(_ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	rootDir := "."
	m := manifest.Load(rootDir)
	warnLegacyKits(m)
	opts := syncengine.SyncOptions{Apply: false, Force: false}

	if len(m.Skills) == 0 {
		fmt.Println("Nothing installed yet — run `agent-hub pull skill <slug>`.")
		return nil
	}

	for _, slug := range sortedKeys(m.Skills) {
		result, err := syncengine.ReconcileTrackedSkill(client, slug, m, opts, rootDir)
		if err != nil {
			return err
		}
		fmt.Println(describeStatus(result))
	}
	return nil
}
