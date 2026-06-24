const VAR_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

/** Extract unique variable names from a prompt body. */
export function parseVariables(body: string): string[] {
  return [...new Set([...body.matchAll(VAR_RE)].map((m) => m[1]))];
}

/** Replace {{var}} placeholders with provided values. Missing vars are left as-is. */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(VAR_RE, (match, name) => values[name] ?? match);
}
