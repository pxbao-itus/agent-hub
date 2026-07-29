// Package config loads and saves the CLI's ~/.agent-hub/config.json.
package config

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

// NormalizeBaseURL validates an Agent Hub origin. For local development only,
// loopback shorthand such as localhost:3000 is normalized to HTTP. Every
// non-loopback host must use HTTPS because MCP tokens are bearer credentials.
func NormalizeBaseURL(value string) (string, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", fmt.Errorf("Agent Hub base URL is required")
	}

	if !strings.Contains(raw, "://") {
		candidate, err := url.Parse("http://" + raw)
		if err != nil || !isLoopbackHost(candidate.Hostname()) {
			return "", fmt.Errorf("Agent Hub base URL must include https:// (localhost may omit http://)")
		}
		raw = "http://" + raw
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid Agent Hub base URL: %w", err)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", fmt.Errorf("Agent Hub base URL must use https:// or loopback http://")
	}
	if parsed.Host == "" || parsed.Hostname() == "" {
		return "", fmt.Errorf("Agent Hub base URL must include a host")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("Agent Hub base URL cannot include credentials, query, or fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", fmt.Errorf("Agent Hub base URL must be an origin without a path")
	}
	if scheme == "http" && !isLoopbackHost(parsed.Hostname()) {
		return "", fmt.Errorf("HTTP is allowed only for localhost; use https:// for remote Agent Hub instances")
	}

	port := parsed.Port()
	if port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return "", fmt.Errorf("Agent Hub base URL has an invalid port")
		}
	}

	hostname := strings.ToLower(parsed.Hostname())
	host := hostname
	if strings.Contains(hostname, ":") {
		host = "[" + hostname + "]"
	}
	if port != "" {
		host += ":" + port
	}
	return scheme + "://" + host, nil
}

func isLoopbackHost(hostname string) bool {
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}

// Normalize validates and canonicalizes persisted CLI configuration.
func Normalize(cfg Config) (Config, error) {
	baseURL, err := NormalizeBaseURL(cfg.BaseURL)
	if err != nil {
		return Config{}, err
	}
	token := strings.TrimSpace(cfg.Token)
	if token == "" {
		return Config{}, fmt.Errorf("MCP token is required")
	}
	return Config{BaseURL: baseURL, Token: token}, nil
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
	cfg, err := Normalize(cfg)
	if err != nil {
		return err
	}
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
		return Config{}, fmt.Errorf("not logged in — run `agenthub login <base-url> <token>` first (expected config at %s)", p)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("config at %s is corrupt: %w", p, err)
	}
	normalized, err := Normalize(cfg)
	if err != nil {
		return Config{}, fmt.Errorf("config at %s is invalid: %w; run `agenthub login <base-url> <token>` again", p, err)
	}
	return normalized, nil
}
