// Package fsio safely installs complete native Skill trees for supported
// agents. Destructive operations are called only after manifest ownership has
// been established by the install planner.
package fsio

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/target"
)

type DiskSkill struct {
	Body  string
	Files []hashutil.FileContent
}

func AssertSafeRelativePath(path string) error {
	if path == "" || filepath.IsAbs(path) {
		return fmt.Errorf("refusing unsafe file path: %s", path)
	}
	cleaned := filepath.Clean(path)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return fmt.Errorf("refusing path that escapes its Skill directory: %s", path)
	}
	if filepath.ToSlash(cleaned) == "SKILL.md" {
		return fmt.Errorf("bundled files cannot replace reserved SKILL.md")
	}
	return nil
}

func ValidateBundleFiles(files []mcp.FileEntry) error {
	seen := make(map[string]bool, len(files))
	paths := make([]string, 0, len(files))
	for _, file := range files {
		if err := AssertSafeRelativePath(file.Path); err != nil {
			return err
		}
		cleaned := filepath.Clean(file.Path)
		key := strings.ToLower(filepath.ToSlash(cleaned))
		if seen[key] {
			return fmt.Errorf("duplicate bundled file path after normalization: %s", file.Path)
		}
		seen[key] = true
		paths = append(paths, key)
	}
	sort.Strings(paths)
	for i, path := range paths {
		for _, other := range paths[i+1:] {
			if strings.HasPrefix(other, path+"/") {
				return fmt.Errorf("bundled file/directory path conflict: %s and %s", path, other)
			}
		}
	}
	return nil
}

func SkillDir(projectDir string, targetName target.Name, installName string) string {
	return filepath.Join(targetName.ProjectSkillRoot(projectDir), installName)
}

func Exists(projectDir string, targetName target.Name, installName string) (bool, error) {
	_, err := os.Lstat(SkillDir(projectDir, targetName, installName))
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

func ensureNoSymlinkComponents(projectDir, path string) error {
	absoluteRoot, err := filepath.Abs(projectDir)
	if err != nil {
		return err
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(absoluteRoot, absolutePath)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("target path escapes project root: %s", path)
	}
	current := absoluteRoot
	for _, component := range strings.Split(relative, string(filepath.Separator)) {
		current = filepath.Join(current, component)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing to traverse symlinked Skill path: %s", current)
		}
	}
	return nil
}

func ReadSkillFromDisk(projectDir string, targetName target.Name, installName string) (*DiskSkill, error) {
	skillDir := SkillDir(projectDir, targetName, installName)
	if err := ensureNoSymlinkComponents(projectDir, skillDir); err != nil {
		return nil, err
	}
	body, err := os.ReadFile(filepath.Join(skillDir, "SKILL.md"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var files []hashutil.FileContent
	err = filepath.WalkDir(skillDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == skillDir {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing symlink inside managed Skill: %s", path)
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(skillDir, path)
		if err != nil {
			return err
		}
		if filepath.ToSlash(relative) == "SKILL.md" {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		files = append(files, hashutil.FileContent{Path: filepath.ToSlash(relative), Content: string(content)})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &DiskSkill{Body: string(body), Files: files}, nil
}

func managedFiles(files []mcp.FileEntry) []string {
	out := make([]string, 0, len(files)+1)
	out = append(out, "SKILL.md")
	for _, file := range files {
		out = append(out, filepath.ToSlash(filepath.Clean(file.Path)))
	}
	sort.Strings(out)
	return out
}

// ReplaceSkill writes a complete tree in a sibling staging directory and then
// swaps it into place. The caller must have already established ownership of
// an existing destination through the manifest.
func ReplaceSkill(
	projectDir string,
	targetName target.Name,
	installName string,
	renderedBody string,
	files []mcp.FileEntry,
) ([]string, string, error) {
	if err := ValidateBundleFiles(files); err != nil {
		return nil, "", err
	}
	skillRoot := targetName.ProjectSkillRoot(projectDir)
	if err := ensureNoSymlinkComponents(projectDir, skillRoot); err != nil {
		return nil, "", err
	}
	if err := os.MkdirAll(skillRoot, 0o755); err != nil {
		return nil, "", err
	}
	stage, err := os.MkdirTemp(skillRoot, ".agent-hub-stage-")
	if err != nil {
		return nil, "", err
	}
	defer os.RemoveAll(stage)
	if err := os.WriteFile(filepath.Join(stage, "SKILL.md"), []byte(renderedBody), 0o644); err != nil {
		return nil, "", err
	}
	for _, file := range files {
		path := filepath.Join(stage, filepath.Clean(file.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, "", err
		}
		if err := os.WriteFile(path, []byte(file.Content), 0o644); err != nil {
			return nil, "", err
		}
	}

	destination := SkillDir(projectDir, targetName, installName)
	if err := ensureNoSymlinkComponents(projectDir, destination); err != nil {
		return nil, "", err
	}
	backup := ""
	if _, err := os.Lstat(destination); err == nil {
		backup, err = os.MkdirTemp(skillRoot, ".agent-hub-backup-")
		if err != nil {
			return nil, "", err
		}
		if err := os.Remove(backup); err != nil {
			return nil, "", err
		}
		if err := os.Rename(destination, backup); err != nil {
			return nil, "", err
		}
	} else if !os.IsNotExist(err) {
		return nil, "", err
	}
	if err := os.Rename(stage, destination); err != nil {
		if backup != "" {
			_ = os.Rename(backup, destination)
		}
		return nil, "", err
	}
	if backup != "" {
		if err := os.RemoveAll(backup); err != nil {
			return nil, "", err
		}
	}
	return managedFiles(files), destination, nil
}

func RemoveManagedSkill(projectDir string, targetName target.Name, installName string) error {
	destination := SkillDir(projectDir, targetName, installName)
	if err := ensureNoSymlinkComponents(projectDir, destination); err != nil {
		return err
	}
	info, err := os.Lstat(destination)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("refusing to remove symlinked managed Skill path: %s", destination)
	}
	return os.RemoveAll(destination)
}
