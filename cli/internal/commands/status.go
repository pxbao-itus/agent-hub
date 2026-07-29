package commands

import (
	"fmt"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/syncengine"
)

func Status(args []string) error {
	opts, err := parseSyncOptions(args)
	if err != nil {
		return err
	}
	opts.dryRun = true
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	projectDir := "."
	m, err := manifest.Load(projectDir)
	if err != nil {
		return fmt.Errorf("could not read .agent-hub-lock.json safely: %w", err)
	}
	warnLegacyKits(m)
	if len(m.SlugsForTarget(opts.target)) == 0 {
		fmt.Printf("Nothing installed for %s — run `agenthub pull skill <slug> --target %s`.\n", opts.target, opts.target)
		return nil
	}
	slugs, err := client.ListSkills()
	if err != nil {
		return err
	}
	results, err := syncengine.ReconcileSnapshot(
		client,
		slugs,
		opts.target,
		m,
		projectDir,
		false,
		false,
	)
	if err != nil {
		return err
	}
	printSummary(results, true)
	return nil
}
