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

type pullOptions struct {
	slug   string
	all    bool
	target target.Name
	global bool
	alias  string
	dryRun bool
}

func parseValue(args []string, index *int, option string) (string, error) {
	if *index+1 >= len(args) {
		return "", fmt.Errorf("%s requires a value", option)
	}
	*index = *index + 1
	return args[*index], nil
}

func parsePull(args []string) (pullOptions, error) {
	if len(args) == 0 || args[0] != "skill" {
		return pullOptions{}, fmt.Errorf("usage: agenthub pull skill <slug>|--all [--target claude|codex] [--global] [--as name] [--dry-run]")
	}
	opts := pullOptions{target: target.Claude}
	for i := 1; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--all":
			opts.all = true
		case arg == "--dry-run":
			opts.dryRun = true
		case arg == "--global":
			opts.global = true
		case arg == "--target":
			value, err := parseValue(args, &i, "--target")
			if err != nil {
				return opts, err
			}
			opts.target, err = target.Parse(value)
			if err != nil {
				return opts, err
			}
		case strings.HasPrefix(arg, "--target="):
			value := strings.TrimPrefix(arg, "--target=")
			var err error
			opts.target, err = target.Parse(value)
			if err != nil {
				return opts, err
			}
		case arg == "--as":
			value, err := parseValue(args, &i, "--as")
			if err != nil {
				return opts, err
			}
			opts.alias = value
		case strings.HasPrefix(arg, "--as="):
			opts.alias = strings.TrimPrefix(arg, "--as=")
		case strings.HasPrefix(arg, "--"):
			return opts, fmt.Errorf("unknown option %s", arg)
		default:
			if opts.slug != "" {
				return opts, fmt.Errorf("only one Skill slug may be pulled at a time")
			}
			opts.slug = arg
		}
	}
	if opts.all == (opts.slug != "") {
		return opts, fmt.Errorf("provide exactly one Skill slug or --all")
	}
	if opts.all && opts.alias != "" {
		return opts, fmt.Errorf("--as is only valid for a single Skill")
	}
	return opts, nil
}

func printResult(result syncengine.Result, dryRun bool) {
	prefix := ""
	if dryRun {
		prefix = "[dry-run] "
	}
	fmt.Printf(
		"%s%s %s -> %s (%s, %s)\n",
		prefix,
		strings.ToUpper(string(result.Action)),
		result.RemoteSlug,
		result.Path,
		result.Target,
		result.Target.InvocationHint(result.InstallName),
	)
}

func printSummary(results []syncengine.Result, dryRun bool) {
	counts := map[syncengine.Action]int{}
	for _, result := range results {
		printResult(result, dryRun)
		counts[result.Action]++
	}
	fmt.Printf(
		"Summary: installed=%d renamed=%d updated=%d overwritten=%d unchanged=%d removed=%d\n",
		counts[syncengine.ActionInstall],
		counts[syncengine.ActionRename],
		counts[syncengine.ActionUpdate],
		counts[syncengine.ActionOverwriteLocal],
		counts[syncengine.ActionUnchanged],
		counts[syncengine.ActionRemove],
	)
}

func Pull(args []string) error {
	opts, err := parsePull(args)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	projectDir, err := resolveScopeRoot(".", opts.global)
	if err != nil {
		return err
	}
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

	rootExisted := true
	if _, err := os.Stat(opts.target.ProjectSkillRoot(projectDir)); os.IsNotExist(err) {
		rootExisted = false
	}

	if opts.all {
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
			true,
			!opts.dryRun,
		)
		if err != nil {
			return err
		}
		printSummary(results, opts.dryRun)
	} else {
		bundle, err := client.PullSkill(opts.slug)
		if err != nil {
			return err
		}
		result, err := syncengine.InstallOne(
			bundle,
			opts.target,
			opts.alias,
			m,
			projectDir,
			!opts.dryRun,
		)
		if err != nil {
			return err
		}
		printResult(result, opts.dryRun)
	}
	if !opts.dryRun && !rootExisted {
		fmt.Printf("Created the %s Skill root. Restart the agent once if it was already running.\n", opts.target)
	}
	return nil
}
