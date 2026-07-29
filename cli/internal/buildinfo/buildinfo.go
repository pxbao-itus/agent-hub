// Package buildinfo exposes release metadata injected by Go linker flags.
package buildinfo

import "fmt"

var (
	Version = "dev"
	Commit  = "unknown"
)

func String() string {
	return fmt.Sprintf("agent-hub %s (commit %s)", Version, Commit)
}
