package commands

import (
	"fmt"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/fsio"
	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
)

func skillFiles(files []mcp.FileEntry) []hashutil.FileContent {
	out := make([]hashutil.FileContent, len(files))
	for i, f := range files {
		out[i] = hashutil.FileContent{Path: f.Path, Content: f.Content}
	}
	return out
}

func Pull(args []string) error {
	if len(args) != 2 || args[0] != "skill" {
		return fmt.Errorf("usage: agent-hub pull skill <slug>")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	rootDir := "."
	m := manifest.Load(rootDir)
	warnLegacyKits(m)

	bundle, err := client.PullSkill(args[1])
	if err != nil {
		return err
	}
	dir, err := fsio.WriteSkill(bundle, rootDir)
	if err != nil {
		return err
	}
	m.Skills[bundle.Slug] = manifest.Entry{
		VersionNo:   bundle.VersionNo,
		ContentHash: hashutil.HashContent(bundle.Body, skillFiles(bundle.Files)),
	}
	fmt.Printf("Pulled skill '%s' (v%d) -> %s\n", bundle.Slug, bundle.VersionNo, dir)

	return manifest.Save(m, rootDir)
}
