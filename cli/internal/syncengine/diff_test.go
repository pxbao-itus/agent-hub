package syncengine

import "testing"

func ptr(s string) *string { return &s }

func TestClassifySyncUpToDate(t *testing.T) {
	if got := ClassifySync(ptr("h1"), "h1", "h1"); got != ActionUpToDate {
		t.Errorf("got %q, want up-to-date", got)
	}
}

func TestClassifySyncUpdate(t *testing.T) {
	if got := ClassifySync(ptr("h1"), "h1", "h2"); got != ActionUpdate {
		t.Errorf("got %q, want update", got)
	}
}

func TestClassifySyncLocalOnly(t *testing.T) {
	if got := ClassifySync(ptr("h2"), "h1", "h1"); got != ActionLocalOnly {
		t.Errorf("got %q, want local-only", got)
	}
}

func TestClassifySyncConflict(t *testing.T) {
	if got := ClassifySync(ptr("h2"), "h1", "h3"); got != ActionConflict {
		t.Errorf("got %q, want conflict", got)
	}
}

func TestClassifySyncMissingDiskIsUpdateNeverConflict(t *testing.T) {
	if got := ClassifySync(nil, "h1", "h1"); got != ActionUpdate {
		t.Errorf("got %q, want update", got)
	}
	if got := ClassifySync(nil, "h1", "h2"); got != ActionUpdate {
		t.Errorf("got %q, want update", got)
	}
}
