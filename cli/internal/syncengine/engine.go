package syncengine

import (
	"fmt"
	"sort"

	"agent-hub-cli/internal/fsio"
	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/manifest"
	"agent-hub-cli/internal/mcp"
	"agent-hub-cli/internal/skillrender"
	"agent-hub-cli/internal/target"
)

type Action string

const (
	ActionInstall        Action = "install"
	ActionUpdate         Action = "update"
	ActionOverwriteLocal Action = "overwrite-local"
	ActionUnchanged      Action = "unchanged"
	ActionRemove         Action = "remove-inaccessible"
)

type Result struct {
	RemoteSlug  string
	InstallName string
	Target      target.Name
	Action      Action
	VersionNo   int
	Path        string
}

type preparedSkill struct {
	bundle       mcp.SkillBundle
	target       target.Name
	installName  string
	oldName      string
	renderedBody string
	contentHash  string
	action       Action
}

func bundleFiles(files []mcp.FileEntry) []hashutil.FileContent {
	out := make([]hashutil.FileContent, len(files))
	for i, file := range files {
		out[i] = hashutil.FileContent{Path: file.Path, Content: file.Content}
	}
	return out
}

func Prepare(
	bundle mcp.SkillBundle,
	targetName target.Name,
	alias string,
	m *manifest.Manifest,
	projectDir string,
) (preparedSkill, error) {
	existing, hasExisting := m.Get(bundle.Slug, targetName)
	installName := alias
	if installName == "" && hasExisting && existing.RendererVersion > 0 {
		installName = existing.InstallName
	}
	var err error
	if installName == "" {
		installName, err = skillrender.ResolveInstallName(bundle, "")
		if err != nil {
			return preparedSkill{}, err
		}
	} else if err := skillrender.ValidateName(installName); err != nil {
		return preparedSkill{}, err
	}

	if owner, ok := m.OwnerOfInstallName(targetName, installName); ok && owner != bundle.Slug {
		return preparedSkill{}, fmt.Errorf(
			"Skill name collision for %q: %s is already managed by %s; use --as <name>",
			installName,
			targetName,
			owner,
		)
	}
	destinationExists, err := fsio.Exists(projectDir, targetName, installName)
	if err != nil {
		return preparedSkill{}, err
	}
	destinationOwned := hasExisting && existing.InstallName == installName
	if destinationExists && !destinationOwned {
		return preparedSkill{}, fmt.Errorf(
			"refusing to overwrite untracked %s Skill directory %q",
			targetName,
			installName,
		)
	}

	rendered, err := skillrender.Render(bundle, installName, targetName)
	if err != nil {
		return preparedSkill{}, err
	}
	if err := fsio.ValidateBundleFiles(bundle.Files); err != nil {
		return preparedSkill{}, err
	}
	remoteHash := hashutil.HashContent(rendered, bundleFiles(bundle.Files))

	action := ActionInstall
	oldName := ""
	if hasExisting {
		oldName = existing.InstallName
		disk, err := fsio.ReadSkillFromDisk(projectDir, targetName, oldName)
		if err != nil {
			return preparedSkill{}, err
		}
		if disk == nil {
			action = ActionUpdate
		} else {
			diskHash := hashutil.HashContent(disk.Body, disk.Files)
			switch {
			case oldName == installName && diskHash == remoteHash:
				action = ActionUnchanged
			case diskHash != existing.ContentHash:
				action = ActionOverwriteLocal
			default:
				action = ActionUpdate
			}
		}
	}
	return preparedSkill{
		bundle:       bundle,
		target:       targetName,
		installName:  installName,
		oldName:      oldName,
		renderedBody: rendered,
		contentHash:  remoteHash,
		action:       action,
	}, nil
}

func Apply(prepared preparedSkill, m *manifest.Manifest, projectDir string) (Result, error) {
	path := fsio.SkillDir(projectDir, prepared.target, prepared.installName)
	managedFiles := []string{"SKILL.md"}
	if prepared.action != ActionUnchanged {
		var err error
		managedFiles, path, err = fsio.ReplaceSkill(
			projectDir,
			prepared.target,
			prepared.installName,
			prepared.renderedBody,
			prepared.bundle.Files,
		)
		if err != nil {
			return Result{}, err
		}
		if prepared.oldName != "" && prepared.oldName != prepared.installName {
			if err := fsio.RemoveManagedSkill(projectDir, prepared.target, prepared.oldName); err != nil {
				return Result{}, err
			}
		}
	} else if existing, ok := m.Get(prepared.bundle.Slug, prepared.target); ok {
		managedFiles = existing.ManagedFiles
	}
	m.Set(prepared.bundle.Slug, prepared.target, manifest.Installation{
		InstallName:     prepared.installName,
		VersionNo:       prepared.bundle.VersionNo,
		RendererVersion: skillrender.RendererVersion,
		ContentHash:     prepared.contentHash,
		ManagedFiles:    managedFiles,
	})
	return Result{
		RemoteSlug:  prepared.bundle.Slug,
		InstallName: prepared.installName,
		Target:      prepared.target,
		Action:      prepared.action,
		VersionNo:   prepared.bundle.VersionNo,
		Path:        path,
	}, nil
}

func InstallOne(
	bundle mcp.SkillBundle,
	targetName target.Name,
	alias string,
	m *manifest.Manifest,
	projectDir string,
	apply bool,
) (Result, error) {
	prepared, err := Prepare(bundle, targetName, alias, m, projectDir)
	if err != nil {
		return Result{}, err
	}
	if !apply {
		return Result{
			RemoteSlug:  bundle.Slug,
			InstallName: prepared.installName,
			Target:      targetName,
			Action:      prepared.action,
			VersionNo:   bundle.VersionNo,
			Path:        fsio.SkillDir(projectDir, targetName, prepared.installName),
		}, nil
	}
	names := []string{prepared.installName}
	if prepared.oldName != "" {
		names = append(names, prepared.oldName)
	}
	transaction, err := fsio.BeginTransaction(projectDir, targetName, names)
	if err != nil {
		return Result{}, err
	}
	result, err := Apply(prepared, m, projectDir)
	if err == nil {
		err = manifest.Save(m, projectDir)
	}
	if err != nil {
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			return Result{}, fmt.Errorf("%w; rollback failed: %v", err, rollbackErr)
		}
		return Result{}, err
	}
	transaction.Commit()
	return result, nil
}

func prepareMany(
	client *mcp.Client,
	slugs []string,
	targetName target.Name,
	m *manifest.Manifest,
	projectDir string,
) ([]preparedSkill, error) {
	prepared := make([]preparedSkill, 0, len(slugs))
	names := make(map[string]string, len(slugs))
	for _, slug := range slugs {
		bundle, err := client.PullSkill(slug)
		if err != nil {
			return nil, fmt.Errorf("pull %s: %w", slug, err)
		}
		candidate, err := Prepare(bundle, targetName, "", m, projectDir)
		if err != nil {
			return nil, fmt.Errorf("prepare %s: %w", slug, err)
		}
		if other, ok := names[candidate.installName]; ok && other != slug {
			return nil, fmt.Errorf(
				"Skill name collision for %q between %s and %s; pull each with --as",
				candidate.installName,
				other,
				slug,
			)
		}
		names[candidate.installName] = slug
		prepared = append(prepared, candidate)
	}
	sort.Slice(prepared, func(i, j int) bool { return prepared[i].bundle.Slug < prepared[j].bundle.Slug })
	return prepared, nil
}

// ReconcileSnapshot applies a complete accessible snapshot. When includeNew
// is false, only currently tracked slugs are fetched, but inaccessible tracked
// installations are still pruned.
func ReconcileSnapshot(
	client *mcp.Client,
	accessibleSlugs []string,
	targetName target.Name,
	m *manifest.Manifest,
	projectDir string,
	includeNew bool,
	apply bool,
) ([]Result, error) {
	accessible := make(map[string]bool, len(accessibleSlugs))
	for _, slug := range accessibleSlugs {
		accessible[slug] = true
	}
	var desired []string
	if includeNew {
		desired = append(desired, accessibleSlugs...)
	} else {
		for _, slug := range m.SlugsForTarget(targetName) {
			if accessible[slug] {
				desired = append(desired, slug)
			}
		}
	}
	sort.Strings(desired)
	prepared, err := prepareMany(client, desired, targetName, m, projectDir)
	if err != nil {
		return nil, err
	}

	var results []Result
	var transaction *fsio.Transaction
	if apply {
		var names []string
		for _, candidate := range prepared {
			names = append(names, candidate.installName)
			if candidate.oldName != "" {
				names = append(names, candidate.oldName)
			}
		}
		for _, slug := range m.SlugsForTarget(targetName) {
			if !accessible[slug] {
				installation, _ := m.Get(slug, targetName)
				names = append(names, installation.InstallName)
			}
		}
		transaction, err = fsio.BeginTransaction(projectDir, targetName, names)
		if err != nil {
			return nil, err
		}
	}
	rollback := func(applyErr error) ([]Result, error) {
		if transaction == nil {
			return results, applyErr
		}
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			return results, fmt.Errorf("%w; rollback failed: %v", applyErr, rollbackErr)
		}
		return results, applyErr
	}
	for _, candidate := range prepared {
		if apply {
			result, err := Apply(candidate, m, projectDir)
			if err != nil {
				return rollback(err)
			}
			results = append(results, result)
		} else {
			results = append(results, Result{
				RemoteSlug:  candidate.bundle.Slug,
				InstallName: candidate.installName,
				Target:      targetName,
				Action:      candidate.action,
				VersionNo:   candidate.bundle.VersionNo,
				Path:        fsio.SkillDir(projectDir, targetName, candidate.installName),
			})
		}
	}
	for _, slug := range m.SlugsForTarget(targetName) {
		if accessible[slug] {
			continue
		}
		installation, _ := m.Get(slug, targetName)
		results = append(results, Result{
			RemoteSlug:  slug,
			InstallName: installation.InstallName,
			Target:      targetName,
			Action:      ActionRemove,
			VersionNo:   installation.VersionNo,
			Path:        fsio.SkillDir(projectDir, targetName, installation.InstallName),
		})
		if apply {
			if err := fsio.RemoveManagedSkill(projectDir, targetName, installation.InstallName); err != nil {
				return rollback(err)
			}
			m.Delete(slug, targetName)
		}
	}
	if apply {
		if err := manifest.Save(m, projectDir); err != nil {
			return rollback(err)
		}
		transaction.Commit()
	}
	sort.Slice(results, func(i, j int) bool { return results[i].RemoteSlug < results[j].RemoteSlug })
	return results, nil
}
