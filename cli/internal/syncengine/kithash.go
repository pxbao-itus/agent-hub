package syncengine

import (
	"strconv"

	"agent-hub-cli/internal/hashutil"
	"agent-hub-cli/internal/mcp"
)

// KitContentHash hashes a kit's body plus its member skill/prompt versions —
// a kit has no file of its own, so its "changed" signal is just "did the
// body or the member list/versions change since last sync".
func KitContentHash(bundle mcp.KitBundle) string {
	files := make([]hashutil.FileContent, 0, len(bundle.Skills)+len(bundle.Prompts))
	for _, s := range bundle.Skills {
		files = append(files, hashutil.FileContent{Path: "skill:" + s.Slug, Content: strconv.Itoa(s.VersionNo)})
	}
	for _, p := range bundle.Prompts {
		files = append(files, hashutil.FileContent{Path: "prompt:" + p.Slug, Content: strconv.Itoa(p.VersionNo)})
	}
	return hashutil.HashContent(bundle.Body, files)
}
