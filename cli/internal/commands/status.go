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
	projectDir, err := resolveScopeRoot(".", opts.global)
	if err != nil {
		return err
	}
	m, err := manifest.Load(projectDir)
	if err != nil {
		return fmt.Errorf("could not read .agent-hub-lock.json safely: %w", err)
	}
	warnLegacyKits(m)
	if len(m.SlugsForTarget(opts.target)) == 0 {
		scopeFlag := ""
		if opts.global {
			scopeFlag = " --global"
		}
		fmt.Printf("Nothing installed for %s — run `agenthub pull skill <slug> --target %s%s`.\n", opts.target, opts.target, scopeFlag)
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
