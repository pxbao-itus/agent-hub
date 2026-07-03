import type { CliConfig } from "./config.js";
import type { Manifest } from "./manifest.js";
import { pullKit, pullSkill, type KitBundle, type SkillBundle } from "./mcp-client.js";
import { readCommandFromDisk, readSkillFromDisk, writePromptAsCommand, writeSkill } from "./fs-write.js";
import { hashContent } from "./hash.js";
import { classifySync, type SyncAction } from "./diff.js";

export type SyncResult = { slug: string; kind: "skill" | "command" | "kit"; action: SyncAction; versionNo: number };
export type SyncOptions = { apply: boolean; force: boolean };

async function reconcileSkillBundle(bundle: SkillBundle, manifest: Manifest, opts: SyncOptions): Promise<SyncResult> {
  const entry = manifest.skills[bundle.slug];
  const disk = await readSkillFromDisk(bundle.slug);
  const diskHash = disk ? hashContent(disk.body, disk.files) : null;
  const remoteHash = hashContent(bundle.body, bundle.files);
  const action = classifySync(diskHash, entry?.contentHash ?? "", remoteHash);

  if (opts.apply && (action === "update" || (action === "conflict" && opts.force))) {
    await writeSkill(bundle);
    manifest.skills[bundle.slug] = { versionNo: bundle.versionNo, contentHash: remoteHash };
  }
  return { slug: bundle.slug, kind: "skill", action, versionNo: bundle.versionNo };
}

async function reconcileCommandBundle(
  prompt: { slug: string; body: string; versionNo: number },
  manifest: Manifest,
  opts: SyncOptions,
): Promise<SyncResult> {
  const entry = manifest.commands[prompt.slug];
  const disk = await readCommandFromDisk(prompt.slug);
  const diskHash = disk !== null ? hashContent(disk) : null;
  const remoteHash = hashContent(prompt.body);
  const action = classifySync(diskHash, entry?.contentHash ?? "", remoteHash);

  if (opts.apply && (action === "update" || (action === "conflict" && opts.force))) {
    await writePromptAsCommand(prompt);
    manifest.commands[prompt.slug] = { versionNo: prompt.versionNo, contentHash: remoteHash };
  }
  return { slug: prompt.slug, kind: "command", action, versionNo: prompt.versionNo };
}

function kitContentHash(bundle: KitBundle): string {
  return hashContent(bundle.body, [
    ...bundle.skills.map((s) => ({ path: `skill:${s.slug}`, content: String(s.versionNo) })),
    ...bundle.prompts.map((p) => ({ path: `prompt:${p.slug}`, content: String(p.versionNo) })),
  ]);
}

export async function reconcileTrackedSkill(
  config: CliConfig,
  slug: string,
  manifest: Manifest,
  opts: SyncOptions,
): Promise<SyncResult> {
  const bundle = await pullSkill(config, slug);
  return reconcileSkillBundle(bundle, manifest, opts);
}

/**
 * A kit has no file of its own on disk — its "conflict" concept doesn't
 * apply, only its member skills/commands (reconciled here too) can carry
 * local edits. The kit's own manifest entry just tracks whether its member
 * list/versions changed since last sync, for reporting.
 */
export async function reconcileTrackedKit(
  config: CliConfig,
  slug: string,
  manifest: Manifest,
  opts: SyncOptions,
): Promise<{ kit: SyncResult; members: SyncResult[] }> {
  const bundle = await pullKit(config, slug);

  const members: SyncResult[] = [];
  for (const skill of bundle.skills) members.push(await reconcileSkillBundle(skill, manifest, opts));
  for (const prompt of bundle.prompts) members.push(await reconcileCommandBundle(prompt, manifest, opts));

  const entry = manifest.kits[slug];
  const remoteHash = kitContentHash(bundle);
  const kitAction: SyncAction = !entry || entry.contentHash !== remoteHash ? "update" : "up-to-date";
  if (opts.apply) {
    manifest.kits[slug] = { versionNo: bundle.versionNo, contentHash: remoteHash };
  }

  return { kit: { slug, kind: "kit", action: kitAction, versionNo: bundle.versionNo }, members };
}
