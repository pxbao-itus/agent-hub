// Package releasepack creates deterministic CLI release archives.
package releasepack

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var semverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
var safeReleaseURLPattern = regexp.MustCompile(`^[A-Za-z0-9:/._~%+-]+$`)

type InputFile struct {
	Source string
	Name   string
	Mode   int64
}

func ValidateVersion(version string) error {
	if !semverPattern.MatchString(version) {
		return fmt.Errorf("invalid CLI semantic version %q", version)
	}
	return nil
}

func ArchiveName(version, arch string) (string, error) {
	if err := ValidateVersion(version); err != nil {
		return "", err
	}
	switch arch {
	case "arm64", "amd64":
	default:
		return "", fmt.Errorf("unsupported macOS architecture %q", arch)
	}
	return fmt.Sprintf("agent-hub_%s_darwin_%s.tar.gz", version, arch), nil
}

func CreateArchive(destination string, epoch time.Time, files []InputFile) error {
	sorted := append([]InputFile(nil), files...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })
	seen := make(map[string]bool, len(sorted))
	for _, file := range sorted {
		if file.Name == "" || filepath.Base(file.Name) != file.Name || seen[file.Name] {
			return fmt.Errorf("invalid or duplicate archive entry %q", file.Name)
		}
		seen[file.Name] = true
	}

	tmp, err := os.CreateTemp(filepath.Dir(destination), ".agent-hub-archive-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	gzipWriter, err := gzip.NewWriterLevel(tmp, gzip.BestCompression)
	if err != nil {
		tmp.Close()
		return err
	}
	epoch = epoch.UTC().Truncate(time.Second)
	gzipWriter.Header.ModTime = epoch
	gzipWriter.Header.OS = 255
	tarWriter := tar.NewWriter(gzipWriter)

	closeWithError := func() {
		_ = tarWriter.Close()
		_ = gzipWriter.Close()
		_ = tmp.Close()
	}
	for _, file := range sorted {
		info, err := os.Stat(file.Source)
		if err != nil {
			closeWithError()
			return err
		}
		if !info.Mode().IsRegular() {
			closeWithError()
			return fmt.Errorf("release input is not a regular file: %s", file.Source)
		}
		header := &tar.Header{
			Name:       file.Name,
			Mode:       file.Mode,
			Size:       info.Size(),
			ModTime:    epoch,
			AccessTime: epoch,
			ChangeTime: epoch,
			Uid:        0,
			Gid:        0,
			Uname:      "root",
			Gname:      "root",
			Format:     tar.FormatPAX,
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			closeWithError()
			return err
		}
		input, err := os.Open(file.Source)
		if err != nil {
			closeWithError()
			return err
		}
		_, copyErr := io.Copy(tarWriter, input)
		closeErr := input.Close()
		if copyErr != nil {
			closeWithError()
			return copyErr
		}
		if closeErr != nil {
			closeWithError()
			return closeErr
		}
	}
	if err := tarWriter.Close(); err != nil {
		gzipWriter.Close()
		tmp.Close()
		return err
	}
	if err := gzipWriter.Close(); err != nil {
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
	if err := os.Chmod(tmpPath, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, destination)
}

func SHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func WriteChecksums(destination string, archives []string) error {
	sorted := append([]string(nil), archives...)
	sort.Strings(sorted)
	var lines []string
	for _, archive := range sorted {
		hash, err := SHA256(archive)
		if err != nil {
			return err
		}
		lines = append(lines, fmt.Sprintf("%s  %s", hash, filepath.Base(archive)))
	}
	return os.WriteFile(destination, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

func RenderInstaller(templatePath, destination, version, baseURL string) error {
	if err := ValidateVersion(version); err != nil {
		return err
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("release base URL must be an HTTPS URL without credentials, query or fragment")
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if !safeReleaseURLPattern.MatchString(baseURL) {
		return fmt.Errorf("release base URL contains characters unsafe for the installer template")
	}
	if !strings.HasSuffix(baseURL, "/cli-v"+version) {
		return fmt.Errorf("release base URL must end with /cli-v%s", version)
	}
	template, err := os.ReadFile(templatePath)
	if err != nil {
		return err
	}
	content := string(template)
	for _, token := range []string{"__CLI_VERSION__", "__CLI_RELEASE_BASE_URL__"} {
		if strings.Count(content, token) != 1 {
			return fmt.Errorf("installer template must contain %s exactly once", token)
		}
	}
	content = strings.Replace(content, "__CLI_VERSION__", version, 1)
	content = strings.Replace(content, "__CLI_RELEASE_BASE_URL__", baseURL, 1)

	tmp, err := os.CreateTemp(filepath.Dir(destination), ".agent-hub-installer-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o755); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.WriteString(content); err != nil {
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
