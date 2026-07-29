// Command checksums writes deterministic SHA-256 lines for release archives.
package main

import (
	"flag"
	"fmt"
	"os"

	"agent-hub-cli/internal/releasepack"
)

func main() {
	output := flag.String("output", "", "checksums output path")
	flag.Parse()
	if *output == "" || flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "--output and at least one archive are required")
		os.Exit(1)
	}
	if err := releasepack.WriteChecksums(*output, flag.Args()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
