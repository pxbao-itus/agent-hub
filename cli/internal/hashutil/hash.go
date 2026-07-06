// Package hashutil computes the deterministic content hash used to detect
// local edits (mirrors the retired TS CLI's hash.ts byte-for-byte: same
// separators, same sort order).
package hashutil

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
)

type FileContent struct {
	Path    string
	Content string
}

// HashContent hashes a body plus its bundled files, sorted by path so file
// order never affects the result.
func HashContent(body string, files []FileContent) string {
	sorted := make([]FileContent, len(files))
	copy(sorted, files)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })

	h := sha256.New()
	h.Write([]byte("body\x00" + body))
	for _, f := range sorted {
		h.Write([]byte("\x00file\x00" + f.Path + "\x00" + f.Content))
	}
	return hex.EncodeToString(h.Sum(nil))
}
