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
	baseURL := flag.String("base-url", "", "immutable release base URL")
	flag.Parse()
	if *template == "" || *output == "" || *version == "" || *baseURL == "" {
		fmt.Fprintln(os.Stderr, "--template, --output, --version and --base-url are required")
		os.Exit(1)
	}
	if err := releasepack.RenderInstaller(*template, *output, *version, *baseURL); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
