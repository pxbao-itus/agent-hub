import { hashContent } from "../hash.js";
import { loadConfig } from "../config.js";
import { writeKit, writeSkill } from "../fs-write.js";
import { pullKit, pullSkill } from "../mcp-client.js";
import { loadManifest, saveManifest } from "../manifest.js";

export async function pullCommand(args: string[]): Promise<void> {
  const [kind, slug] = args;
  if ((kind !== "skill" && kind !== "kit") || !slug) {
    throw new Error("Usage: agent-hub pull <skill|kit> <slug>");
  }

  const config = await loadConfig();
  const manifest = await loadManifest();

  if (kind === "skill") {
    const bundle = await pullSkill(config, slug);
    const dir = await writeSkill(bundle);
    manifest.skills[bundle.slug] = { versionNo: bundle.versionNo, contentHash: hashContent(bundle.body, bundle.files) };
    console.log(`Pulled skill '${bundle.slug}' (v${bundle.versionNo}) -> ${dir}`);
  } else {
    const bundle = await pullKit(config, slug);
    const { skillDirs, commandFiles } = await writeKit(bundle);
    for (const skill of bundle.skills) {
      manifest.skills[skill.slug] = { versionNo: skill.versionNo, contentHash: hashContent(skill.body, skill.files) };
    }
    for (const prompt of bundle.prompts) {
      manifest.commands[prompt.slug] = { versionNo: prompt.versionNo, contentHash: hashContent(prompt.body) };
    }
    manifest.kits[bundle.slug] = {
      versionNo: bundle.versionNo,
      contentHash: hashContent(bundle.body, [
        ...bundle.skills.map((s) => ({ path: `skill:${s.slug}`, content: String(s.versionNo) })),
        ...bundle.prompts.map((p) => ({ path: `prompt:${p.slug}`, content: String(p.versionNo) })),
      ]),
    };
    console.log(
      `Pulled kit '${bundle.slug}' (v${bundle.versionNo}): ${skillDirs.length} skill(s), ${commandFiles.length} command(s).`,
    );
  }

  await saveManifest(manifest);
}
