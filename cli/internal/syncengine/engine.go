package syncengine

import (
	"agent-hub-cli/internal/fsio"
	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
)

type SyncOptions struct {
	Apply bool
	Force bool
}

type SyncResult struct {
	Slug      string
	Kind      string // "skill"
	Action    SyncAction
	VersionNo int
}

func bundleFileContents(files []mcp.FileEntry) []hashutil.FileContent {
	out := make([]hashutil.FileContent, len(files))
	for i, f := range files {
		out[i] = hashutil.FileContent{Path: f.Path, Content: f.Content}
	}
	return out
}

// staleFilePaths finds files present on disk from a previous pull that are
// no longer part of the current bundle — the TS CLI's known limitation
// (README: "stale files can accumulate on disk"), fixed here (plans/49-go-cli.md §1).
func staleFilePaths(diskFiles []hashutil.FileContent, bundleFiles []mcp.FileEntry) []string {
	current := make(map[string]bool, len(bundleFiles))
	for _, f := range bundleFiles {
		current[f.Path] = true
	}
	var stale []string
	for _, f := range diskFiles {
		if !current[f.Path] {
			stale = append(stale, f.Path)
		}
	}
	return stale
}

func reconcileSkillBundle(bundle mcp.SkillBundle, m *manifest.Manifest, opts SyncOptions, rootDir string) (SyncResult, error) {
	entry, hasEntry := m.Skills[bundle.Slug]
	disk, err := fsio.ReadSkillFromDisk(bundle.Slug, rootDir)
	if err != nil {
		return SyncResult{}, err
	}

	var diskHashPtr *string
	if disk != nil {
		h := hashutil.HashContent(disk.Body, disk.Files)
		diskHashPtr = &h
	}
	remoteHash := hashutil.HashContent(bundle.Body, bundleFileContents(bundle.Files))
	lastKnown := ""
	if hasEntry {
		lastKnown = entry.ContentHash
	}
	action := ClassifySync(diskHashPtr, lastKnown, remoteHash)

	if opts.Apply && (action == ActionUpdate || (action == ActionConflict && opts.Force)) {
		if disk != nil {
			if stale := staleFilePaths(disk.Files, bundle.Files); len(stale) > 0 {
				if err := fsio.RemoveStaleFiles(bundle.Slug, stale, rootDir); err != nil {
					return SyncResult{}, err
				}
			}
		}
		if _, err := fsio.WriteSkill(bundle, rootDir); err != nil {
			return SyncResult{}, err
		}
		m.Skills[bundle.Slug] = manifest.Entry{VersionNo: bundle.VersionNo, ContentHash: remoteHash}
	}
	return SyncResult{Slug: bundle.Slug, Kind: "skill", Action: action, VersionNo: bundle.VersionNo}, nil
}

func ReconcileTrackedSkill(client *mcp.Client, slug string, m *manifest.Manifest, opts SyncOptions, rootDir string) (SyncResult, error) {
	bundle, err := client.PullSkill(slug)
	if err != nil {
		return SyncResult{}, err
	}
	return reconcileSkillBundle(bundle, m, opts, rootDir)
}
