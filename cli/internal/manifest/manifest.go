// Package manifest owns .agent-hub-lock.json, including v1 compatibility and
// target-specific native Skill installations.
package manifest

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"

	"agent-hub-cli/internal/target"
)

const (
	filename      = ".agent-hub-lock.json"
	SchemaVersion = 3
)

type LegacyEntry struct {
	VersionNo   int    `json:"versionNo"`
	ContentHash string `json:"contentHash"`
}

type Installation struct {
	InstallName     string   `json:"installName"`
	CustomName      bool     `json:"customName,omitempty"`
	VersionNo       int      `json:"versionNo"`
	RendererVersion int      `json:"rendererVersion"`
	ContentHash     string   `json:"contentHash"`
	ManagedFiles    []string `json:"managedFiles"`
}

type Skill struct {
	Installations map[string]Installation `json:"installations"`
}

type Manifest struct {
	SchemaVersion int                    `json:"schemaVersion"`
	Skills        map[string]Skill       `json:"skills"`
	Commands      map[string]LegacyEntry `json:"commands,omitempty"`
	LegacyKits    map[string]LegacyEntry `json:"-"`
}

func empty() *Manifest {
	return &Manifest{
		SchemaVersion: SchemaVersion,
		Skills:        map[string]Skill{},
		Commands:      map[string]LegacyEntry{},
		LegacyKits:    map[string]LegacyEntry{},
	}
}

func Load(rootDir string) (*Manifest, error) {
	data, err := os.ReadFile(filepath.Join(rootDir, filename))
	if errors.Is(err, os.ErrNotExist) {
		return empty(), nil
	}
	if err != nil {
		return nil, err
	}

	var header struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return nil, err
	}
	if header.SchemaVersion >= SchemaVersion {
		m := empty()
		if err := json.Unmarshal(data, m); err != nil {
			return nil, err
		}
		if m.Skills == nil {
			m.Skills = map[string]Skill{}
		}
		if m.Commands == nil {
			m.Commands = map[string]LegacyEntry{}
		}
		for slug, skill := range m.Skills {
			if skill.Installations == nil {
				skill.Installations = map[string]Installation{}
				m.Skills[slug] = skill
			}
		}
		return m, nil
	}

	var legacy struct {
		Skills   map[string]LegacyEntry `json:"skills"`
		Kits     map[string]LegacyEntry `json:"kits"`
		Commands map[string]LegacyEntry `json:"commands"`
	}
	if err := json.Unmarshal(data, &legacy); err != nil {
		return nil, err
	}
	m := empty()
	m.Commands = legacy.Commands
	if m.Commands == nil {
		m.Commands = map[string]LegacyEntry{}
	}
	m.LegacyKits = legacy.Kits
	if m.LegacyKits == nil {
		m.LegacyKits = map[string]LegacyEntry{}
	}
	for slug, entry := range legacy.Skills {
		m.Skills[slug] = Skill{Installations: map[string]Installation{
			string(target.Claude): {
				InstallName:     slug,
				VersionNo:       entry.VersionNo,
				RendererVersion: 0,
				ContentHash:     entry.ContentHash,
				ManagedFiles:    []string{"SKILL.md"},
			},
		}}
	}
	return m, nil
}

func Save(m *Manifest, rootDir string) error {
	m.SchemaVersion = SchemaVersion
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	path := filepath.Join(rootDir, filename)
	tmp, err := os.CreateTemp(rootDir, ".agent-hub-lock-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func (m *Manifest) Get(remoteSlug string, targetName target.Name) (Installation, bool) {
	skill, ok := m.Skills[remoteSlug]
	if !ok {
		return Installation{}, false
	}
	installation, ok := skill.Installations[string(targetName)]
	return installation, ok
}

func (m *Manifest) Set(remoteSlug string, targetName target.Name, installation Installation) {
	skill, ok := m.Skills[remoteSlug]
	if !ok || skill.Installations == nil {
		skill = Skill{Installations: map[string]Installation{}}
	}
	skill.Installations[string(targetName)] = installation
	m.Skills[remoteSlug] = skill
}

func (m *Manifest) Delete(remoteSlug string, targetName target.Name) {
	skill, ok := m.Skills[remoteSlug]
	if !ok {
		return
	}
	delete(skill.Installations, string(targetName))
	if len(skill.Installations) == 0 {
		delete(m.Skills, remoteSlug)
		return
	}
	m.Skills[remoteSlug] = skill
}

func (m *Manifest) SlugsForTarget(targetName target.Name) []string {
	slugs := make([]string, 0)
	for slug, skill := range m.Skills {
		if _, ok := skill.Installations[string(targetName)]; ok {
			slugs = append(slugs, slug)
		}
	}
	sort.Strings(slugs)
	return slugs
}

func (m *Manifest) OwnerOfInstallName(targetName target.Name, installName string) (string, bool) {
	for slug, skill := range m.Skills {
		if installation, ok := skill.Installations[string(targetName)]; ok && installation.InstallName == installName {
			return slug, true
		}
	}
	return "", false
}

func (m *Manifest) Empty() bool {
	return len(m.Skills) == 0 && len(m.Commands) == 0
}

func Remove(rootDir string) error {
	err := os.Remove(filepath.Join(rootDir, filename))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
