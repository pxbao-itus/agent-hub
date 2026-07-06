// Package fsio writes pulled skills/prompts to .claude/ and reads them back
// for sync's disk-vs-manifest comparison.
package fsio

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/mcp"
)

const claudeDir = ".claude"

// AssertSafeRelativePath rejects a path that would escape the skill's own
// directory. File paths come from the server (artifactFiles.path) — trusted
// today, but this writes to the caller's real filesystem, so don't assume
// the server is honest.
func AssertSafeRelativePath(path string) error {
	if filepath.IsAbs(path) {
		return fmt.Errorf("refusing to write absolute path: %s", path)
	}
	cleaned := filepath.Clean(path)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing to write path that escapes its directory: %s", path)
	}
	return nil
}

func WriteSkill(bundle mcp.SkillBundle, rootDir string) (string, error) {
	skillDir := filepath.Join(rootDir, claudeDir, "skills", bundle.Slug)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(bundle.Body), 0o644); err != nil {
		return "", err
	}
	for _, f := range bundle.Files {
		if err := AssertSafeRelativePath(f.Path); err != nil {
			return "", err
		}
		filePath := filepath.Join(skillDir, f.Path)
		if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(filePath, []byte(f.Content), 0o644); err != nil {
			return "", err
		}
	}
	return skillDir, nil
}

func WritePromptAsCommand(slug, body, rootDir string) (string, error) {
	commandsDir := filepath.Join(rootDir, claudeDir, "commands")
	if err := os.MkdirAll(commandsDir, 0o755); err != nil {
		return "", err
	}
	filePath := filepath.Join(commandsDir, slug+".md")
	if err := os.WriteFile(filePath, []byte(body), 0o644); err != nil {
		return "", err
	}
	return filePath, nil
}

// WriteKit writes every member skill and prompt-as-command in a kit bundle.
func WriteKit(bundle mcp.KitBundle, rootDir string) (skillDirs []string, commandFiles []string, err error) {
	for _, skill := range bundle.Skills {
		dir, err := WriteSkill(skill, rootDir)
		if err != nil {
			return nil, nil, err
		}
		skillDirs = append(skillDirs, dir)
	}
	for _, prompt := range bundle.Prompts {
		file, err := WritePromptAsCommand(prompt.Slug, prompt.Body, rootDir)
		if err != nil {
			return nil, nil, err
		}
		commandFiles = append(commandFiles, file)
	}
	return skillDirs, commandFiles, nil
}

type DiskSkill struct {
	Body  string
	Files []hashutil.FileContent
}

// ReadSkillFromDisk reads back what's currently installed for a skill, for
// sync's disk-vs-manifest comparison. Returns nil if not installed.
func ReadSkillFromDisk(slug, rootDir string) (*DiskSkill, error) {
	skillDir := filepath.Join(rootDir, claudeDir, "skills", slug)
	body, err := os.ReadFile(filepath.Join(skillDir, "SKILL.md"))
	if err != nil {
		return nil, nil
	}

	var files []hashutil.FileContent
	var walk func(dir, prefix string) error
	walk = func(dir, prefix string) error {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if prefix == "" && entry.Name() == "SKILL.md" {
				continue
			}
			full := filepath.Join(dir, entry.Name())
			relPath := entry.Name()
			if prefix != "" {
				relPath = prefix + "/" + entry.Name()
			}
			if entry.IsDir() {
				if err := walk(full, relPath); err != nil {
					return err
				}
			} else {
				content, err := os.ReadFile(full)
				if err != nil {
					return err
				}
				files = append(files, hashutil.FileContent{Path: relPath, Content: string(content)})
			}
		}
		return nil
	}
	if err := walk(skillDir, ""); err != nil {
		return nil, err
	}
	return &DiskSkill{Body: string(body), Files: files}, nil
}

// ReadCommandFromDisk reads back a pulled-prompt command file. Returns nil
// if not installed.
func ReadCommandFromDisk(slug, rootDir string) *string {
	content, err := os.ReadFile(filepath.Join(rootDir, claudeDir, "commands", slug+".md"))
	if err != nil {
		return nil
	}
	s := string(content)
	return &s
}

// RemoveStaleFiles deletes files that were installed for a skill on a
// previous pull but are no longer part of its current bundle — the TS CLI's
// known limitation (README: "stale files can accumulate on disk"), fixed
// here as part of the Go rewrite (plans/49-go-cli.md §1).
func RemoveStaleFiles(slug string, paths []string, rootDir string) error {
	skillDir := filepath.Join(rootDir, claudeDir, "skills", slug)
	for _, p := range paths {
		if err := AssertSafeRelativePath(p); err != nil {
			continue // defensive: paths here came from a previous safe write, should never trip this
		}
		if err := os.Remove(filepath.Join(skillDir, p)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
