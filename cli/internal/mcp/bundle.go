package mcp

// FileEntry is a bundled file inside a skill, as returned by pull_skill.
type FileEntry struct {
	Path     string  `json:"path"`
	Content  string  `json:"content"`
	MimeType *string `json:"mimeType"`
}

// SkillBundle mirrors server/mcp/server.ts's pull_skill JSON shape exactly.
type SkillBundle struct {
	SchemaVersion int         `json:"schemaVersion"`
	Kind          string      `json:"kind"`
	Slug          string      `json:"slug"`
	Title         string      `json:"title"`
	Description   *string     `json:"description"`
	Body          string      `json:"body"`
	Files         []FileEntry `json:"files"`
	VersionNo     int         `json:"versionNo"`
	UpdatedAt     string      `json:"updatedAt"`
}

// bundleError is the shape pull_skill returns instead of a bundle
// when the slug isn't found or isn't accessible to this token.
type bundleError struct {
	Error string `json:"error"`
}
