/**
 * Slugify a title for use as a local artifact slug segment. Shared by the
 * MCP server (registers this as the actual command/tool-arg name) and any
 * UI that needs to display the exact slug an agent would use.
 */
export function slugify(s: string, fallback = "prompt"): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}
