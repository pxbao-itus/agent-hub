import { loadConfig } from "../config.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { reconcileTrackedKit, reconcileTrackedSkill, type SyncResult } from "../sync-engine.js";

/** `force` decides whether a "conflict" was actually resolved (written) or left alone — same raw action reads differently either way. */
function describe(r: SyncResult, force: boolean): string {
  switch (r.action) {
    case "up-to-date":
      return `${r.slug}: up to date (v${r.versionNo})`;
    case "update":
      return `${r.slug}: updated to v${r.versionNo}`;
    case "local-only":
      return `${r.slug}: local changes kept (server unchanged)`;
    case "conflict":
      return force
        ? `${r.slug}: forced update to v${r.versionNo} (local edits overwritten)`
        : `${r.slug}: CONFLICT — local edits AND a newer server version (v${r.versionNo}) both exist. Re-run with --force to overwrite local edits.`;
  }
}

export async function syncCommand(args: string[]): Promise<void> {
  const force = args.includes("--force");
  const config = await loadConfig();
  const manifest = await loadManifest();
  const opts = { apply: true, force };

  // Kits first — their member skills/prompts are reconciled as part of the
  // kit call, so skipping those slugs below avoids re-fetching (and
  // double-printing) anything already tracked both directly and via a kit.
  const touchedSkills = new Set<string>();
  let unresolvedConflicts = 0;

  for (const slug of Object.keys(manifest.kits)) {
    const { kit, members } = await reconcileTrackedKit(config, slug, manifest, opts);
    console.log(describe(kit, force));
    for (const m of members) {
      touchedSkills.add(m.slug);
      console.log(`  ${describe(m, force)}`);
      if (m.action === "conflict" && !force) unresolvedConflicts++;
    }
  }

  for (const slug of Object.keys(manifest.skills)) {
    if (touchedSkills.has(slug)) continue;
    const result = await reconcileTrackedSkill(config, slug, manifest, opts);
    console.log(describe(result, force));
    if (result.action === "conflict" && !force) unresolvedConflicts++;
  }

  await saveManifest(manifest);

  if (unresolvedConflicts > 0) {
    console.error(`\n${unresolvedConflicts} conflict(s) — re-run with --force to overwrite local edits, or resolve manually.`);
    process.exitCode = 1;
  }
}
