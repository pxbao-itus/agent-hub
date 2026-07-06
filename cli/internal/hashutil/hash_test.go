package hashutil

import "testing"

func TestHashContentDeterministic(t *testing.T) {
	a := HashContent("body", []FileContent{{Path: "a.md", Content: "1"}})
	b := HashContent("body", []FileContent{{Path: "a.md", Content: "1"}})
	if a != b {
		t.Errorf("expected deterministic hash, got %q and %q", a, b)
	}
}

func TestHashContentOrderIndependent(t *testing.T) {
	a := HashContent("body", []FileContent{{Path: "b.md", Content: "2"}, {Path: "a.md", Content: "1"}})
	b := HashContent("body", []FileContent{{Path: "a.md", Content: "1"}, {Path: "b.md", Content: "2"}})
	if a != b {
		t.Errorf("expected order-independent hash, got %q and %q", a, b)
	}
}

func TestHashContentChangesWithBody(t *testing.T) {
	a := HashContent("body1", nil)
	b := HashContent("body2", nil)
	if a == b {
		t.Error("expected different hashes for different bodies")
	}
}

func TestHashContentChangesWithFileContent(t *testing.T) {
	a := HashContent("body", []FileContent{{Path: "a.md", Content: "1"}})
	b := HashContent("body", []FileContent{{Path: "a.md", Content: "2"}})
	if a == b {
		t.Error("expected different hashes for different file content")
	}
}

func TestHashContentChangesWhenFileAddedOrRemoved(t *testing.T) {
	withFile := HashContent("body", []FileContent{{Path: "a.md", Content: "1"}})
	withoutFile := HashContent("body", nil)
	if withFile == withoutFile {
		t.Error("expected different hashes when a file is added/removed")
	}
}

func TestHashContentNoDelimiterCollision(t *testing.T) {
	a := HashContent("body", []FileContent{{Path: "ab", Content: "c"}})
	b := HashContent("body", []FileContent{{Path: "a", Content: "bc"}})
	if a == b {
		t.Error("expected a path/content boundary shift to change the hash")
	}
}
