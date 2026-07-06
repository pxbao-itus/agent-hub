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
	Kind      string // "skill" | "command" | "kit"
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

func reconcileCommandBundle(prompt mcp.PromptEntry, m *manifest.Manifest, opts SyncOptions, rootDir string) (SyncResult, error) {
	entry, hasEntry := m.Commands[prompt.Slug]
	disk := fsio.ReadCommandFromDisk(prompt.Slug, rootDir)
	var diskHashPtr *string
	if disk != nil {
		h := hashutil.HashContent(*disk, nil)
		diskHashPtr = &h
	}
	remoteHash := hashutil.HashContent(prompt.Body, nil)
	lastKnown := ""
	if hasEntry {
		lastKnown = entry.ContentHash
	}
	action := ClassifySync(diskHashPtr, lastKnown, remoteHash)

	if opts.Apply && (action == ActionUpdate || (action == ActionConflict && opts.Force)) {
		if _, err := fsio.WritePromptAsCommand(prompt.Slug, prompt.Body, rootDir); err != nil {
			return SyncResult{}, err
		}
		m.Commands[prompt.Slug] = manifest.Entry{VersionNo: prompt.VersionNo, ContentHash: remoteHash}
	}
	return SyncResult{Slug: prompt.Slug, Kind: "command", Action: action, VersionNo: prompt.VersionNo}, nil
}

func ReconcileTrackedSkill(client *mcp.Client, slug string, m *manifest.Manifest, opts SyncOptions, rootDir string) (SyncResult, error) {
	bundle, err := client.PullSkill(slug)
	if err != nil {
		return SyncResult{}, err
	}
	return reconcileSkillBundle(bundle, m, opts, rootDir)
}

type KitReconcileResult struct {
	Kit     SyncResult
	Members []SyncResult
}

// ReconcileTrackedKit has no file of its own on disk — its "conflict"
// concept doesn't apply, only its member skills/commands (reconciled here
// too) can carry local edits. The kit's own manifest entry just tracks
// whether its member list/versions changed since last sync, for reporting.
func ReconcileTrackedKit(client *mcp.Client, slug string, m *manifest.Manifest, opts SyncOptions, rootDir string) (KitReconcileResult, error) {
	bundle, err := client.PullKit(slug)
	if err != nil {
		return KitReconcileResult{}, err
	}

	var members []SyncResult
	for _, skill := range bundle.Skills {
		r, err := reconcileSkillBundle(skill, m, opts, rootDir)
		if err != nil {
			return KitReconcileResult{}, err
		}
		members = append(members, r)
	}
	for _, prompt := range bundle.Prompts {
		r, err := reconcileCommandBundle(prompt, m, opts, rootDir)
		if err != nil {
			return KitReconcileResult{}, err
		}
		members = append(members, r)
	}

	entry, hasEntry := m.Kits[slug]
	remoteHash := KitContentHash(bundle)
	kitAction := ActionUpdate
	if hasEntry && entry.ContentHash == remoteHash {
		kitAction = ActionUpToDate
	}
	if opts.Apply {
		m.Kits[slug] = manifest.Entry{VersionNo: bundle.VersionNo, ContentHash: remoteHash}
	}

	return KitReconcileResult{
		Kit:     SyncResult{Slug: slug, Kind: "kit", Action: kitAction, VersionNo: bundle.VersionNo},
		Members: members,
	}, nil
}
