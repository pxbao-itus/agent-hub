// Package config loads and saves the CLI's ~/.agent-hub/config.json.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

func dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".agent-hub"), nil
}

func path() (string, error) {
	d, err := dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "config.json"), nil
}

// Save writes the config, creating ~/.agent-hub with owner-only permissions.
func Save(cfg Config) error {
	d, err := dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(d, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	p, err := path()
	if err != nil {
		return err
	}
	return os.WriteFile(p, data, 0o600)
}

// Load reads the saved config, or a friendly error if `login` was never run.
func Load() (Config, error) {
	p, err := path()
	if err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return Config{}, fmt.Errorf("not logged in — run `agent-hub login <base-url> <token>` first (expected config at %s)", p)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("config at %s is corrupt: %w", p, err)
	}
	return cfg, nil
}
