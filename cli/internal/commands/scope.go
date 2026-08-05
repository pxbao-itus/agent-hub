package commands

import (
	"fmt"
	"os"
)

// resolveScopeRoot returns the common base used by target paths, the manifest,
// and the recoverable transaction journal. Project scope uses the caller's
// working directory; global scope uses the current user's home directory.
func resolveScopeRoot(projectDir string, global bool) (string, error) {
	if !global {
		return projectDir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not resolve home directory for global scope: %w", err)
	}
	if home == "" {
		return "", fmt.Errorf("could not resolve home directory for global scope")
	}
	return home, nil
}
