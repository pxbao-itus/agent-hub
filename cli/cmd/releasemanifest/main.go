// Command releasemanifest writes the self-hosted CLI release manifest.
package main

import (
	"flag"
	"fmt"
	"os"

	"agent-hub-cli/internal/releasepack"
)

func main() {
	output := flag.String("output", "", "release.json output path")
	version := flag.String("version", "", "CLI semantic version")
	channel := flag.String("channel", "preview", "release channel (preview or stable)")
	flag.Parse()
	if *output == "" || *version == "" {
		fmt.Fprintln(os.Stderr, "--output and --version are required")
		os.Exit(1)
	}
	if err := releasepack.WriteManifest(*output, *version, *channel); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
