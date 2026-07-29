package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeBaseURL(t *testing.T) {
	tests := map[string]string{
		"localhost:3000":          "http://localhost:3000",
		"http://localhost:3000/":  "http://localhost:3000",
		"127.0.0.1:3000":          "http://127.0.0.1:3000",
		"http://127.0.0.2:8080":   "http://127.0.0.2:8080",
		"[::1]:3000":              "http://[::1]:3000",
		"http://[::1]:3000":       "http://[::1]:3000",
		"https://Hub.Example.com": "https://hub.example.com",
		"https://example.com/":    "https://example.com",
	}
	for input, expected := range tests {
		t.Run(input, func(t *testing.T) {
			actual, err := NormalizeBaseURL(input)
			if err != nil {
				t.Fatal(err)
			}
			if actual != expected {
				t.Fatalf("NormalizeBaseURL(%q) = %q, want %q", input, actual, expected)
			}
		})
	}
}

func TestNormalizeBaseURLRejectsUnsafeValues(t *testing.T) {
	for _, input := range []string{
		"",
		"example.com",
		"example.com:3000",
		"http://example.com",
		"ftp://localhost:3000",
		"https://user@example.com",
		"https://example.com/path",
		"https://example.com?query=1",
		"https://example.com#fragment",
		"https://example.com:0",
		"https://example.com:65536",
		"localhost:3000/path",
	} {
		t.Run(input, func(t *testing.T) {
			if value, err := NormalizeBaseURL(input); err == nil {
				t.Fatalf("NormalizeBaseURL(%q) = %q, want error", input, value)
			}
		})
	}
}

func TestSavePersistsNormalizedConfiguration(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if err := Save(Config{BaseURL: "localhost:3000", Token: "  mcp_test  "}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(home, ".agent-hub", "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved Config
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if saved.BaseURL != "http://localhost:3000" || saved.Token != "mcp_test" {
		t.Fatalf("saved config = %+v", saved)
	}
}

func TestLoadMigratesLegacyLoopbackShorthandInMemory(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	configDirectory := filepath.Join(home, ".agent-hub")
	if err := os.MkdirAll(configDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := []byte(`{"baseUrl":"localhost:3000","token":"mcp_test"}`)
	if err := os.WriteFile(filepath.Join(configDirectory, "config.json"), legacy, 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.BaseURL != "http://localhost:3000" {
		t.Fatalf("loaded base URL = %q", cfg.BaseURL)
	}
}

func TestLoadRejectsLegacyUnsafeRemoteURL(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	configDirectory := filepath.Join(home, ".agent-hub")
	if err := os.MkdirAll(configDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := []byte(`{"baseUrl":"hub.example.com","token":"mcp_test"}`)
	if err := os.WriteFile(filepath.Join(configDirectory, "config.json"), legacy, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "run `agenthub login") {
		t.Fatalf("Load() error = %v", err)
	}
}
