export type DiffLine =
  | { type: "context"; line: string }
  | { type: "add"; line: string }
  | { type: "remove"; line: string };

/**
 * Compute a unified line-level diff between two text strings.
 * Uses Myers-style LCS. Suitable for short prompt bodies.
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");

  // Build LCS table
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back to build diff
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      result.push({ type: "context", line: a[i] });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i + 1]?.[j] <= dp[i]?.[j + 1])) {
      result.push({ type: "add", line: b[j] });
      j++;
    } else {
      result.push({ type: "remove", line: a[i] });
      i++;
    }
  }

  return result;
}

/** Returns true if there are any actual changes between two texts. */
export function hasChanges(diff: DiffLine[]): boolean {
  return diff.some((d) => d.type !== "context");
}
