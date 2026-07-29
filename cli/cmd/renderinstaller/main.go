// Command renderinstaller injects immutable release metadata into install.sh.
package main

import (
	"flag"
	"fmt"
	"os"

	"agent-hub-cli/internal/releasepack"
)

func main() {
	template := flag.String("template", "", "installer template path")
	output := flag.String("output", "", "installer output path")
	version := flag.String("version", "", "CLI semantic version")
	flag.Parse()
	if *template == "" || *output == "" || *version == "" {
		fmt.Fprintln(os.Stderr, "--template, --output and --version are required")
		os.Exit(1)
	}
	if err := releasepack.RenderInstaller(*template, *output, *version); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
