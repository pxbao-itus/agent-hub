package commands

import (
	"fmt"

	"agent-hub-cli/internal/config"
)

func Login(args []string) error {
	if len(args) != 2 {
		return fmt.Errorf("usage: agent-hub login <base-url> <token>")
	}
	cfg := config.Config{BaseURL: args[0], Token: args[1]}
	if err := config.Save(cfg); err != nil {
		return err
	}
	fmt.Printf("Logged in to %s\n", cfg.BaseURL)
	return nil
}
