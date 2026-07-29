package commands

import (
	"fmt"
	"os"
	"strings"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/fsio"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/syncengine"
	"agent-hub-cli/internal/target"
)

type syncOptions struct {
	target target.Name
	dryRun bool
}

func parseSyncOptions(args []string) (syncOptions, error) {
	opts := syncOptions{target: target.Claude}
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--dry-run":
			opts.dryRun = true
		case args[i] == "--force":
			fmt.Fprintln(os.Stderr, "Warning: --force is no longer needed; managed Skills are authoritative and always overwritten.")
		case args[i] == "--target":
			value, err := parseValue(args, &i, "--target")
			if err != nil {
				return opts, err
			}
			opts.target, err = target.Parse(value)
			if err != nil {
				return opts, err
			}
		case strings.HasPrefix(args[i], "--target="):
			var err error
			opts.target, err = target.Parse(strings.TrimPrefix(args[i], "--target="))
			if err != nil {
				return opts, err
			}
		default:
			return opts, fmt.Errorf("unknown option %s", args[i])
		}
	}
	return opts, nil
}

func warnLegacyKits(m *manifest.Manifest) {
	if len(m.LegacyKits) == 0 {
		return
	}
	fmt.Fprintf(
		os.Stderr,
		"Warning: %d legacy Kit tracking entries will be removed when the manifest is next written; local files remain untouched.\n",
		len(m.LegacyKits),
	)
}

func Sync(args []string) error {
	opts, err := parseSyncOptions(args)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	projectDir := "."
	if !opts.dryRun {
		if err := fsio.RecoverPending(projectDir); err != nil {
			return err
		}
	}
	m, err := manifest.Load(projectDir)
	if err != nil {
		return fmt.Errorf("could not read .agent-hub-lock.json safely: %w", err)
	}
	warnLegacyKits(m)
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
		!opts.dryRun,
	)
	if err != nil {
		return err
	}
	printSummary(results, opts.dryRun)
	if opts.dryRun {
		return nil
	}
	return nil
}
