package commands

import (
	"fmt"
	"os"
	"sort"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/syncengine"
)

// describeSync explains a raw sync action — whether a "conflict" was
// actually resolved (written) or left alone reads differently depending on
// --force.
func describeSync(r syncengine.SyncResult, force bool) string {
	switch r.Action {
	case syncengine.ActionUpToDate:
		return fmt.Sprintf("%s: up to date (v%d)", r.Slug, r.VersionNo)
	case syncengine.ActionUpdate:
		return fmt.Sprintf("%s: updated to v%d", r.Slug, r.VersionNo)
	case syncengine.ActionLocalOnly:
		return fmt.Sprintf("%s: local changes kept (server unchanged)", r.Slug)
	case syncengine.ActionConflict:
		if force {
			return fmt.Sprintf("%s: forced update to v%d (local edits overwritten)", r.Slug, r.VersionNo)
		}
		return fmt.Sprintf("%s: CONFLICT — local edits AND a newer server version (v%d) both exist. Re-run with --force to overwrite local edits.", r.Slug, r.VersionNo)
	}
	return fmt.Sprintf("%s: unknown action %q", r.Slug, r.Action)
}

func sortedKeys(m map[string]manifest.Entry) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func Sync(args []string) error {
	force := false
	for _, a := range args {
		if a == "--force" {
			force = true
		}
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	rootDir := "."
	m := manifest.Load(rootDir)
	opts := syncengine.SyncOptions{Apply: true, Force: force}

	// Kits first — their member skills/prompts are reconciled as part of the
	// kit call, so skipping those slugs below avoids re-fetching (and
	// double-printing) anything already tracked both directly and via a kit.
	touchedSkills := map[string]bool{}
	unresolvedConflicts := 0

	for _, slug := range sortedKeys(m.Kits) {
		result, err := syncengine.ReconcileTrackedKit(client, slug, m, opts, rootDir)
		if err != nil {
			return err
		}
		fmt.Println(describeSync(result.Kit, force))
		for _, member := range result.Members {
			touchedSkills[member.Slug] = true
			fmt.Printf("  %s\n", describeSync(member, force))
			if member.Action == syncengine.ActionConflict && !force {
				unresolvedConflicts++
			}
		}
	}

	for _, slug := range sortedKeys(m.Skills) {
		if touchedSkills[slug] {
			continue
		}
		result, err := syncengine.ReconcileTrackedSkill(client, slug, m, opts, rootDir)
		if err != nil {
			return err
		}
		fmt.Println(describeSync(result, force))
		if result.Action == syncengine.ActionConflict && !force {
			unresolvedConflicts++
		}
	}

	if err := manifest.Save(m, rootDir); err != nil {
		return err
	}

	if unresolvedConflicts > 0 {
		fmt.Fprintf(os.Stderr, "\n%d conflict(s) — re-run with --force to overwrite local edits, or resolve manually.\n", unresolvedConflicts)
		os.Exit(1)
	}
	return nil
}
