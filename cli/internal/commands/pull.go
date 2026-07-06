package commands

import (
	"fmt"

	"agent-hub-cli/internal/config"
	"agent-hub-cli/internal/fsio"
	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/syncengine"
)

func skillFiles(files []mcp.FileEntry) []hashutil.FileContent {
	out := make([]hashutil.FileContent, len(files))
	for i, f := range files {
		out[i] = hashutil.FileContent{Path: f.Path, Content: f.Content}
	}
	return out
}

func Pull(args []string) error {
	if len(args) != 2 || (args[0] != "skill" && args[0] != "kit") {
		return fmt.Errorf("usage: agent-hub pull <skill|kit> <slug>")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	client := mcp.NewClient(cfg)
	rootDir := "."
	m := manifest.Load(rootDir)

	switch args[0] {
	case "skill":
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

	case "kit":
		bundle, err := client.PullKit(args[1])
		if err != nil {
			return err
		}
		skillDirs, commandFiles, err := fsio.WriteKit(bundle, rootDir)
		if err != nil {
			return err
		}
		for _, skill := range bundle.Skills {
			m.Skills[skill.Slug] = manifest.Entry{
				VersionNo:   skill.VersionNo,
				ContentHash: hashutil.HashContent(skill.Body, skillFiles(skill.Files)),
			}
		}
		for _, prompt := range bundle.Prompts {
			m.Commands[prompt.Slug] = manifest.Entry{
				VersionNo:   prompt.VersionNo,
				ContentHash: hashutil.HashContent(prompt.Body, nil),
			}
		}
		m.Kits[bundle.Slug] = manifest.Entry{
			VersionNo:   bundle.VersionNo,
			ContentHash: syncengine.KitContentHash(bundle),
		}
		fmt.Printf("Pulled kit '%s' (v%d): %d skill(s), %d command(s).\n", bundle.Slug, bundle.VersionNo, len(skillDirs), len(commandFiles))
	}

	return manifest.Save(m, rootDir)
}
