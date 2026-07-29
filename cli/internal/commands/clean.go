package commands

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"agent-hub-cli/internal/fsio"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/target"
)

type cleanOptions struct {
	target *target.Name
	dryRun bool
	yes    bool
}

type cleanEntry struct {
	slug        string
	target      target.Name
	installName string
}

func parseCleanOptions(args []string) (cleanOptions, error) {
	var opts cleanOptions
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--dry-run":
			opts.dryRun = true
		case args[i] == "--yes":
			opts.yes = true
		case args[i] == "--target":
			value, err := parseValue(args, &i, "--target")
			if err != nil {
				return opts, err
			}
			parsed, err := target.Parse(value)
			if err != nil {
				return opts, err
			}
			opts.target = &parsed
		case strings.HasPrefix(args[i], "--target="):
			parsed, err := target.Parse(strings.TrimPrefix(args[i], "--target="))
			if err != nil {
				return opts, err
			}
			opts.target = &parsed
		default:
			return opts, fmt.Errorf("unknown option %s", args[i])
		}
	}
	return opts, nil
}

func collectCleanEntries(m *manifest.Manifest, targetFilter *target.Name) ([]cleanEntry, error) {
	var entries []cleanEntry
	for slug, skill := range m.Skills {
		for targetValue, installation := range skill.Installations {
			if targetValue != string(target.Claude) && targetValue != string(target.Codex) {
				return nil, fmt.Errorf("invalid target %q in managed Skill %s", targetValue, slug)
			}
			targetName, err := target.Parse(targetValue)
			if err != nil {
				return nil, fmt.Errorf("invalid target in managed Skill %s: %w", slug, err)
			}
			if targetFilter != nil && targetName != *targetFilter {
				continue
			}
			entries = append(entries, cleanEntry{
				slug:        slug,
				target:      targetName,
				installName: installation.InstallName,
			})
		}
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].target == entries[j].target {
			if entries[i].installName == entries[j].installName {
				return entries[i].slug < entries[j].slug
			}
			return entries[i].installName < entries[j].installName
		}
		return entries[i].target < entries[j].target
	})
	return entries, nil
}

func printCleanPlan(output io.Writer, entries []cleanEntry, dryRun bool) {
	if dryRun {
		fmt.Fprintln(output, "[dry-run] Agent Hub managed Skills to remove:")
	} else {
		fmt.Fprintln(output, "The following Agent Hub managed Skills will be removed:")
	}
	currentTarget := target.Name("")
	for _, entry := range entries {
		if entry.target != currentTarget {
			currentTarget = entry.target
			label := "Claude"
			if currentTarget == target.Codex {
				label = "Codex"
			}
			fmt.Fprintf(output, "\n  %s:\n", label)
		}
		fmt.Fprintf(output, "    - %s (%s)\n", entry.installName, entry.slug)
	}
	fmt.Fprintln(output)
}

func cleanProject(
	args []string,
	input io.Reader,
	output io.Writer,
	projectDir string,
	interactive bool,
) error {
	opts, err := parseCleanOptions(args)
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
	entries, err := collectCleanEntries(m, opts.target)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		fmt.Fprintln(output, "No Agent Hub managed Skills found.")
		return nil
	}
	printCleanPlan(output, entries, opts.dryRun)
	if opts.dryRun {
		return nil
	}
	if !opts.yes {
		if !interactive {
			return fmt.Errorf("confirmation requires an interactive terminal; rerun with --yes")
		}
		fmt.Fprintf(output, "Remove %d managed Skill installation(s)? [y/N] ", len(entries))
		answer, readErr := bufio.NewReader(input).ReadString('\n')
		if readErr != nil && len(answer) == 0 {
			return readErr
		}
		switch strings.ToLower(strings.TrimSpace(answer)) {
		case "y", "yes":
		default:
			fmt.Fprintln(output, "Clean cancelled.")
			return nil
		}
	}

	refs := make([]fsio.ManagedSkillRef, 0, len(entries))
	for _, entry := range entries {
		refs = append(refs, fsio.ManagedSkillRef{
			Target:      entry.target,
			InstallName: entry.installName,
		})
	}
	transaction, err := fsio.BeginMultiTargetTransaction(projectDir, refs)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := fsio.RemoveManagedSkill(projectDir, entry.target, entry.installName); err != nil {
			if rollbackErr := transaction.Rollback(); rollbackErr != nil {
				return fmt.Errorf("%w; rollback failed: %v", err, rollbackErr)
			}
			return err
		}
		m.Delete(entry.slug, entry.target)
	}
	if m.Empty() {
		err = manifest.Remove(projectDir)
	} else {
		err = manifest.Save(m, projectDir)
	}
	if err != nil {
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			return fmt.Errorf("%w; rollback failed: %v", err, rollbackErr)
		}
		return err
	}
	transaction.Commit()
	fmt.Fprintf(output, "Removed %d managed Skill installation(s).\n", len(entries))
	return nil
}

func Clean(args []string) error {
	info, err := os.Stdin.Stat()
	interactive := err == nil && info.Mode()&os.ModeCharDevice != 0
	return cleanProject(args, os.Stdin, os.Stdout, ".", interactive)
}
