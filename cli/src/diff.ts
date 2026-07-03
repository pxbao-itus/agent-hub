/**
 * Sync decision table (§5, plans/42-cli-filesystem-sync.md):
 *
 * | disk changed? | remote changed? | action      |
 * |----------------|------------------|-------------|
 * | no             | no               | up-to-date  |
 * | no             | yes              | update      |
 * | yes            | no               | local-only  |
 * | yes            | yes              | conflict    |
 *
 * `diskHash === null` means the file was never installed or was deleted —
 * treated as "update" (nothing local to lose).
 */
export type SyncAction = "up-to-date" | "update" | "local-only" | "conflict";

export function classifySync(diskHash: string | null, lastKnownHash: string, remoteHash: string): SyncAction {
  if (diskHash === null) return "update";
  const diskChanged = diskHash !== lastKnownHash;
  const remoteChanged = remoteHash !== lastKnownHash;
  if (!diskChanged && !remoteChanged) return "up-to-date";
  if (!diskChanged && remoteChanged) return "update";
  if (diskChanged && !remoteChanged) return "local-only";
  return "conflict";
}
