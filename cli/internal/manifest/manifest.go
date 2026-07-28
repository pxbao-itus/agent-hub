// Package manifest reads/writes .agent-hub-lock.json — the record of what's
// been pulled, used by sync/status to detect local vs. server changes.
package manifest

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const filename = ".agent-hub-lock.json"

type Entry struct {
	VersionNo   int    `json:"versionNo"`
	ContentHash string `json:"contentHash"`
}

type Manifest struct {
	Skills     map[string]Entry `json:"skills"`
	Commands   map[string]Entry `json:"commands"`
	LegacyKits map[string]Entry `json:"-"`
}

func empty() *Manifest {
	return &Manifest{
		Skills:     map[string]Entry{},
		Commands:   map[string]Entry{},
		LegacyKits: map[string]Entry{},
	}
}

// Load reads the manifest from rootDir, or an empty one if it doesn't exist
// or fails to parse — mirroring the TS CLI, which treats any read failure as
// "nothing tracked yet" rather than an error.
func Load(rootDir string) *Manifest {
	data, err := os.ReadFile(filepath.Join(rootDir, filename))
	if err != nil {
		return empty()
	}
	var stored struct {
		Skills   map[string]Entry `json:"skills"`
		Kits     map[string]Entry `json:"kits"`
		Commands map[string]Entry `json:"commands"`
	}
	if err := json.Unmarshal(data, &stored); err != nil {
		return empty()
	}
	m := empty()
	if stored.Skills != nil {
		m.Skills = stored.Skills
	}
	if stored.Commands != nil {
		m.Commands = stored.Commands
	}
	if stored.Kits != nil {
		m.LegacyKits = stored.Kits
	}
	return m
}

func Save(m *Manifest, rootDir string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(rootDir, filename), data, 0o644)
}
