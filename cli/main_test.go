package main

import (
	"bytes"
	"testing"

	"agent-hub-cli/internal/buildinfo"
)

func TestPrintVersion(t *testing.T) {
	oldVersion, oldCommit := buildinfo.Version, buildinfo.Commit
	t.Cleanup(func() {
		buildinfo.Version, buildinfo.Commit = oldVersion, oldCommit
	})
	buildinfo.Version, buildinfo.Commit = "0.1.0", "abc1234"
	var output bytes.Buffer
	if err := printVersion(&output, nil); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "agenthub 0.1.0 (commit abc1234)\n" {
		t.Fatalf("output = %q", got)
	}
	if err := printVersion(&output, []string{"extra"}); err == nil {
		t.Fatal("expected extra argument error")
	}
}
