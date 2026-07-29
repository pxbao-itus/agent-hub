package target

import (
	"fmt"
	"path/filepath"
)

type Name string

const (
	Claude Name = "claude"
	Codex  Name = "codex"
)

func Parse(value string) (Name, error) {
	if value == "" {
		return Claude, nil
	}
	switch Name(value) {
	case Claude, Codex:
		return Name(value), nil
	default:
		return "", fmt.Errorf("unsupported target %q (supported: claude, codex)", value)
	}
}

func (n Name) ProjectSkillRoot(projectDir string) string {
	if n == Codex {
		return filepath.Join(projectDir, ".agents", "skills")
	}
	return filepath.Join(projectDir, ".claude", "skills")
}

func (n Name) InvocationHint(installName string) string {
	if n == Codex {
		return fmt.Sprintf("$%s (or select it with /skills)", installName)
	}
	return "/" + installName
}
