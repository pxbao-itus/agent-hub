package skillrender

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/target"
)

const (
	RendererVersion = 2
	defaultPrefix   = "agenthub-"
)

var validName = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)

type frontmatter struct {
	lines            []string
	closeIndex       int
	nameIndex        int
	descriptionIndex int
	name             string
}

func ValidateName(name string) error {
	if !validName.MatchString(name) {
		return fmt.Errorf("invalid Skill name %q: use 1-64 lowercase letters, numbers, or hyphens", name)
	}
	return nil
}

func ShortSlug(remoteSlug string) string {
	parts := strings.Split(remoteSlug, ".")
	return parts[len(parts)-1]
}

func parseScalar(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var decoded string
	if strings.HasPrefix(value, `"`) && json.Unmarshal([]byte(value), &decoded) == nil {
		return decoded
	}
	if len(value) >= 2 && value[0] == '\'' && value[len(value)-1] == '\'' {
		return strings.ReplaceAll(value[1:len(value)-1], "''", "'")
	}
	return strings.Fields(value)[0]
}

func parseFrontmatter(body string) (*frontmatter, error) {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	lines := strings.Split(body, "\n")
	if len(lines) == 0 || lines[0] != "---" {
		return nil, nil
	}
	fm := &frontmatter{lines: lines, closeIndex: -1, nameIndex: -1, descriptionIndex: -1}
	for i := 1; i < len(lines); i++ {
		if lines[i] == "---" {
			fm.closeIndex = i
			break
		}
	}
	if fm.closeIndex < 0 {
		return nil, fmt.Errorf("SKILL.md frontmatter starts with --- but has no closing ---")
	}
	for i := 1; i < fm.closeIndex; i++ {
		line := lines[i]
		if strings.HasPrefix(line, "name:") {
			if fm.nameIndex >= 0 {
				return nil, fmt.Errorf("SKILL.md frontmatter contains duplicate name fields")
			}
			fm.nameIndex = i
			fm.name = parseScalar(strings.TrimPrefix(line, "name:"))
		}
		if strings.HasPrefix(line, "description:") {
			if fm.descriptionIndex >= 0 {
				return nil, fmt.Errorf("SKILL.md frontmatter contains duplicate description fields")
			}
			fm.descriptionIndex = i
		}
	}
	return fm, nil
}

func ResolveInstallName(bundle mcp.SkillBundle, alias string) (string, error) {
	if alias != "" {
		if err := ValidateName(alias); err != nil {
			return "", err
		}
		return alias, nil
	}
	candidate := defaultPrefix + ShortSlug(bundle.Slug)
	if err := ValidateName(candidate); err != nil {
		return "", fmt.Errorf("cannot derive an Agent Hub Skill name from %q: %w; use --as <name>", bundle.Slug, err)
	}
	return candidate, nil
}

// ResolveLegacyInstallName reproduces the pre-v2 naming rule so sync can
// distinguish a historical default name from a user-selected --as name.
func ResolveLegacyInstallName(bundle mcp.SkillBundle) (string, error) {
	fm, err := parseFrontmatter(bundle.Body)
	if err != nil {
		return "", err
	}
	candidate := ""
	if fm != nil {
		candidate = fm.name
	}
	if candidate == "" {
		candidate = ShortSlug(bundle.Slug)
	}
	if err := ValidateName(candidate); err != nil {
		return "", fmt.Errorf("cannot derive a legacy native Skill name from %q: %w", bundle.Slug, err)
	}
	return candidate, nil
}

func quoted(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func Render(bundle mcp.SkillBundle, installName string, _ target.Name) (string, error) {
	if err := ValidateName(installName); err != nil {
		return "", err
	}
	body := strings.ReplaceAll(bundle.Body, "\r\n", "\n")
	description := bundle.Title
	if bundle.Description != nil && strings.TrimSpace(*bundle.Description) != "" {
		description = strings.TrimSpace(*bundle.Description)
	}
	fm, err := parseFrontmatter(body)
	if err != nil {
		return "", err
	}
	if fm == nil {
		return fmt.Sprintf(
			"---\nname: %s\ndescription: %s\n---\n\n%s",
			installName,
			quoted(description),
			strings.TrimLeft(body, "\n"),
		), nil
	}

	lines := append([]string(nil), fm.lines...)
	if fm.nameIndex >= 0 {
		lines[fm.nameIndex] = "name: " + installName
	} else {
		lines = append(lines[:fm.closeIndex], append([]string{"name: " + installName}, lines[fm.closeIndex:]...)...)
		fm.closeIndex++
	}
	if fm.descriptionIndex < 0 {
		lines = append(lines[:fm.closeIndex], append([]string{"description: " + quoted(description)}, lines[fm.closeIndex:]...)...)
	}
	return strings.Join(lines, "\n"), nil
}
