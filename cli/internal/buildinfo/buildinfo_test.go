package buildinfo

import "testing"

func TestString(t *testing.T) {
	oldVersion, oldCommit := Version, Commit
	t.Cleanup(func() {
		Version, Commit = oldVersion, oldCommit
	})
	Version, Commit = "1.2.3", "abc1234"
	if got := String(); got != "agenthub 1.2.3 (commit abc1234)" {
		t.Fatalf("String() = %q", got)
	}
}
