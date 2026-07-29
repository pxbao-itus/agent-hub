// Command agent-hub is a filesystem-sync CLI for Agent Hub — pulls
// skills onto disk for tools that read .claude/skills
// directly instead of going through MCP.
package main

import (
	"fmt"
	"io"
	"os"

	"agent-hub-cli/internal/buildinfo"
	"agent-hub-cli/internal/commands"
)

func printVersion(output io.Writer, args []string) error {
	if len(args) != 0 {
		return fmt.Errorf("version does not accept arguments")
	}
	_, err := fmt.Fprintln(output, buildinfo.String())
	return err
}

func usage() {
	fmt.Fprintln(os.Stderr, "Usage: agent-hub <login|pull|sync|status|version> ...")
	fmt.Fprintln(os.Stderr, "  agent-hub login <base-url> <token>")
	fmt.Fprintln(os.Stderr, "  agent-hub pull skill <slug>|--all [--target claude|codex] [--as name] [--dry-run]")
	fmt.Fprintln(os.Stderr, "  agent-hub sync [--target claude|codex] [--dry-run]")
	fmt.Fprintln(os.Stderr, "  agent-hub status [--target claude|codex]")
	fmt.Fprintln(os.Stderr, "  agent-hub version")
}

func run() error {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}
	command, rest := os.Args[1], os.Args[2:]

	switch command {
	case "version", "--version", "-v":
		return printVersion(os.Stdout, rest)
	case "login":
		return commands.Login(rest)
	case "pull":
		return commands.Pull(rest)
	case "sync":
		return commands.Sync(rest)
	case "status":
		return commands.Status(rest)
	default:
		usage()
		os.Exit(1)
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
