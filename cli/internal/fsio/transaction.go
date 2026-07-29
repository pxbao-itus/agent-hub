package fsio

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"agent-hub-cli/internal/target"
)

const (
	transactionJournal = ".agent-hub-transaction.json"
	manifestFilename   = ".agent-hub-lock.json"
)

type transactionRecord struct {
	Target      string `json:"target"`
	InstallName string `json:"installName"`
	Existed     bool   `json:"existed"`
	BackupName  string `json:"backupName,omitempty"`
}

type transactionState struct {
	Version         int                 `json:"version"`
	BackupDir       string              `json:"backupDir"`
	ManifestExisted bool                `json:"manifestExisted"`
	Records         []transactionRecord `json:"records"`
}

type Transaction struct {
	projectDir string
	state      transactionState
}

func validateJournalName(value, label string) error {
	if value == "" || value == "." || value == ".." ||
		filepath.Base(value) != value || strings.ContainsAny(value, `/\`) {
		return fmt.Errorf("invalid %s in Agent Hub transaction journal", label)
	}
	return nil
}

func copyFile(source, destination string, mode fs.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode.Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	if err := output.Sync(); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing symlink inside managed Skill: %s", path)
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		targetPath := destination
		if relative != "." {
			targetPath = filepath.Join(destination, relative)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(targetPath, info.Mode().Perm())
		}
		return copyFile(path, targetPath, info.Mode())
	})
}

func writeJournal(projectDir string, state transactionState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(projectDir, ".agent-hub-transaction-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, filepath.Join(projectDir, transactionJournal))
}

func loadTransaction(projectDir string) (*Transaction, error) {
	data, err := os.ReadFile(filepath.Join(projectDir, transactionJournal))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var state transactionState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("invalid Agent Hub transaction journal: %w", err)
	}
	if state.Version != 1 {
		return nil, fmt.Errorf("unsupported Agent Hub transaction journal version %d", state.Version)
	}
	if err := validateJournalName(state.BackupDir, "backup directory"); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(state.BackupDir, ".agent-hub-txn-") {
		return nil, fmt.Errorf("invalid backup directory in Agent Hub transaction journal")
	}
	backupPath := filepath.Join(projectDir, state.BackupDir)
	if info, err := os.Lstat(backupPath); err != nil {
		return nil, fmt.Errorf("missing Agent Hub transaction backup: %w", err)
	} else if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("invalid Agent Hub transaction backup directory")
	}
	for _, record := range state.Records {
		targetName, err := target.Parse(record.Target)
		if err != nil {
			return nil, fmt.Errorf("invalid target in Agent Hub transaction journal: %w", err)
		}
		if err := validateJournalName(record.InstallName, "Skill install name"); err != nil {
			return nil, err
		}
		if record.Existed {
			if err := validateJournalName(record.BackupName, "Skill backup name"); err != nil {
				return nil, err
			}
			if !strings.HasPrefix(record.BackupName, "skill-") {
				return nil, fmt.Errorf("invalid Skill backup name in Agent Hub transaction journal")
			}
		}
		if err := ensureNoSymlinkComponents(projectDir, SkillDir(projectDir, targetName, record.InstallName)); err != nil {
			return nil, err
		}
	}
	return &Transaction{projectDir: projectDir, state: state}, nil
}

func restoreManifest(projectDir, backupDir string, existed bool) error {
	destination := filepath.Join(projectDir, manifestFilename)
	if !existed {
		if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	source := filepath.Join(backupDir, "manifest.json")
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(projectDir, ".agent-hub-lock-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, destination)
}

func (transaction *Transaction) restore() error {
	backupDir := filepath.Join(transaction.projectDir, transaction.state.BackupDir)
	for _, record := range transaction.state.Records {
		targetName, _ := target.Parse(record.Target)
		destination := SkillDir(transaction.projectDir, targetName, record.InstallName)
		if err := RemoveManagedSkill(transaction.projectDir, targetName, record.InstallName); err != nil {
			return err
		}
		if !record.Existed {
			continue
		}
		source := filepath.Join(backupDir, record.BackupName)
		if _, err := os.Stat(source); err != nil {
			return fmt.Errorf("missing Skill transaction backup for %s: %w", record.InstallName, err)
		}
		if err := copyTree(source, destination); err != nil {
			return err
		}
	}
	return restoreManifest(
		transaction.projectDir,
		backupDir,
		transaction.state.ManifestExisted,
	)
}

func (transaction *Transaction) cleanup() {
	_ = os.Remove(filepath.Join(transaction.projectDir, transactionJournal))
	_ = os.RemoveAll(filepath.Join(transaction.projectDir, transaction.state.BackupDir))
}

func (transaction *Transaction) Rollback() error {
	if err := transaction.restore(); err != nil {
		return err
	}
	transaction.cleanup()
	return nil
}

func (transaction *Transaction) Commit() {
	// Removing the journal is the commit point. A leftover backup directory is
	// harmless and can be cleaned best-effort after the committed state is
	// durable.
	transaction.cleanup()
}

// RecoverPending restores the last complete filesystem and manifest snapshot
// if a previous CLI process stopped after publishing its transaction journal.
func RecoverPending(projectDir string) error {
	transaction, err := loadTransaction(projectDir)
	if err != nil || transaction == nil {
		return err
	}
	if err := transaction.Rollback(); err != nil {
		return fmt.Errorf("could not recover interrupted Agent Hub transaction: %w", err)
	}
	return nil
}

// BeginTransaction snapshots every managed directory that may be changed.
// The journal is published only after all backups are complete, so any later
// failure or process interruption can restore both the directories and lockfile.
func BeginTransaction(
	projectDir string,
	targetName target.Name,
	installNames []string,
) (*Transaction, error) {
	if err := RecoverPending(projectDir); err != nil {
		return nil, err
	}
	unique := make(map[string]bool, len(installNames))
	names := make([]string, 0, len(installNames))
	for _, name := range installNames {
		if err := validateJournalName(name, "Skill install name"); err != nil {
			return nil, err
		}
		if !unique[name] {
			unique[name] = true
			names = append(names, name)
		}
	}
	sort.Strings(names)

	backupPath, err := os.MkdirTemp(projectDir, ".agent-hub-txn-")
	if err != nil {
		return nil, err
	}
	state := transactionState{
		Version:   1,
		BackupDir: filepath.Base(backupPath),
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(backupPath)
		}
	}()

	manifestPath := filepath.Join(projectDir, manifestFilename)
	if info, err := os.Stat(manifestPath); err == nil {
		state.ManifestExisted = true
		if err := copyFile(manifestPath, filepath.Join(backupPath, "manifest.json"), info.Mode()); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}

	for index, name := range names {
		record := transactionRecord{
			Target:      string(targetName),
			InstallName: name,
		}
		source := SkillDir(projectDir, targetName, name)
		if err := ensureNoSymlinkComponents(projectDir, source); err != nil {
			return nil, err
		}
		if info, err := os.Stat(source); err == nil {
			if !info.IsDir() {
				return nil, fmt.Errorf("managed Skill path is not a directory: %s", source)
			}
			record.Existed = true
			record.BackupName = fmt.Sprintf("skill-%04d", index)
			if err := copyTree(source, filepath.Join(backupPath, record.BackupName)); err != nil {
				return nil, err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		state.Records = append(state.Records, record)
	}
	if err := writeJournal(projectDir, state); err != nil {
		return nil, err
	}
	cleanup = false
	return &Transaction{projectDir: projectDir, state: state}, nil
}
