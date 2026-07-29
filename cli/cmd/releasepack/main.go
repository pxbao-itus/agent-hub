// Command releasepack packages an already-built Agent Hub CLI binary.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"agent-hub-cli/internal/releasepack"
)

func main() {
	version := flag.String("version", "", "CLI semantic version")
	arch := flag.String("arch", "", "macOS architecture")
	binary := flag.String("binary", "", "path to built agent-hub binary")
	license := flag.String("license", "", "path to LICENSE")
	readme := flag.String("readme", "", "path to CLI README")
	output := flag.String("output", "", "output directory")
	epochValue := flag.String("epoch", "", "source epoch in seconds")
	flag.Parse()

	epochSeconds, err := strconv.ParseInt(*epochValue, 10, 64)
	if err != nil || epochSeconds <= 0 {
		fatal("invalid --epoch")
	}
	name, err := releasepack.ArchiveName(*version, *arch)
	if err != nil {
		fatal(err.Error())
	}
	if *binary == "" || *license == "" || *readme == "" || *output == "" {
		fatal("--binary, --license, --readme and --output are required")
	}
	if err := os.MkdirAll(*output, 0o755); err != nil {
		fatal(err.Error())
	}
	destination := filepath.Join(*output, name)
	err = releasepack.CreateArchive(destination, time.Unix(epochSeconds, 0), []releasepack.InputFile{
		{Source: *binary, Name: "agent-hub", Mode: 0o755},
		{Source: *license, Name: "LICENSE", Mode: 0o644},
		{Source: *readme, Name: "README.md", Mode: 0o644},
	})
	if err != nil {
		fatal(err.Error())
	}
	fmt.Println(destination)
}

func fatal(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
