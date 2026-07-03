import { loadConfig } from "../config.js";
import { loadManifest } from "../manifest.js";
import { reconcileTrackedKit, reconcileTrackedSkill, type SyncResult } from "../sync-engine.js";

function describe(r: SyncResult): string {
  switch (r.action) {
    case "up-to-date":
      return `${r.slug}: up to date (v${r.versionNo})`;
    case "update":
      return `${r.slug}: server has v${r.versionNo} (not yet pulled — run \`agent-hub sync\`)`;
    case "local-only":
      return `${r.slug}: local changes, server unchanged`;
    case "conflict":
      return `${r.slug}: CONFLICT — local edits AND server v${r.versionNo} both changed`;
  }
}

/** Read-only dry run of sync's diff logic — writes nothing, per plans/42-cli-filesystem-sync.md §7. */
export async function statusCommand(): Promise<void> {
  const config = await loadConfig();
  const manifest = await loadManifest();
  const opts = { apply: false, force: false };

  if (Object.keys(manifest.skills).length === 0 && Object.keys(manifest.kits).length === 0) {
    console.log("Nothing installed yet — run `agent-hub pull skill <slug>` or `agent-hub pull kit <slug>`.");
    return;
  }

  const touchedSkills = new Set<string>();
  for (const slug of Object.keys(manifest.kits)) {
    const { kit, members } = await reconcileTrackedKit(config, slug, manifest, opts);
    console.log(describe(kit));
    for (const m of members) {
      touchedSkills.add(m.slug);
      console.log(`  ${describe(m)}`);
    }
  }

  for (const slug of Object.keys(manifest.skills)) {
    if (touchedSkills.has(slug)) continue;
    console.log(describe(await reconcileTrackedSkill(config, slug, manifest, opts)));
  }
}
