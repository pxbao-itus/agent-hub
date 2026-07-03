import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { KitBundle, SkillBundle } from "./mcp-client.js";

const CLAUDE_DIR = ".claude";

/**
 * File paths come from the server (artifactFiles.path) — trusted today, but
 * this writes to the caller's real filesystem, so reject anything that would
 * escape the skill's own directory rather than assume the server is honest.
 */
function assertSafeRelativePath(path: string): void {
  if (isAbsolute(path)) throw new Error(`Refusing to write absolute path: ${path}`);
  const normalized = normalize(path);
  if (normalized.startsWith("..") || normalized.split(sep).includes("..")) {
    throw new Error(`Refusing to write path that escapes its directory: ${path}`);
  }
}

export async function writeSkill(bundle: SkillBundle, rootDir = process.cwd()): Promise<string> {
  const skillDir = join(rootDir, CLAUDE_DIR, "skills", bundle.slug);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), bundle.body, "utf8");
  for (const file of bundle.files) {
    assertSafeRelativePath(file.path);
    const filePath = join(skillDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, "utf8");
  }
  return skillDir;
}

export async function writePromptAsCommand(
  prompt: { slug: string; body: string },
  rootDir = process.cwd(),
): Promise<string> {
  const commandsDir = join(rootDir, CLAUDE_DIR, "commands");
  await mkdir(commandsDir, { recursive: true });
  const filePath = join(commandsDir, `${prompt.slug}.md`);
  await writeFile(filePath, prompt.body, "utf8");
  return filePath;
}

/** Reads back what's currently on disk for a skill, for sync's disk-vs-manifest comparison. `null` if not installed. */
export async function readSkillFromDisk(
  slug: string,
  rootDir = process.cwd(),
): Promise<{ body: string; files: { path: string; content: string }[] } | null> {
  const skillDir = join(rootDir, CLAUDE_DIR, "skills", slug);
  let body: string;
  try {
    body = await readFile(join(skillDir, "SKILL.md"), "utf8");
  } catch {
    return null;
  }

  const files: { path: string; content: string }[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (prefix === "" && entry.name === "SKILL.md") continue;
      const full = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relPath);
      } else {
        files.push({ path: relPath, content: await readFile(full, "utf8") });
      }
    }
  }
  await walk(skillDir, "");
  return { body, files };
}

/** Reads back a pulled-prompt command file, for sync's disk-vs-manifest comparison. `null` if not installed. */
export async function readCommandFromDisk(slug: string, rootDir = process.cwd()): Promise<string | null> {
  try {
    return await readFile(join(rootDir, CLAUDE_DIR, "commands", `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

export async function writeKit(
  bundle: KitBundle,
  rootDir = process.cwd(),
): Promise<{ skillDirs: string[]; commandFiles: string[] }> {
  const skillDirs: string[] = [];
  for (const skill of bundle.skills) {
    skillDirs.push(await writeSkill(skill, rootDir));
  }
  const commandFiles: string[] = [];
  for (const prompt of bundle.prompts) {
    commandFiles.push(await writePromptAsCommand(prompt, rootDir));
  }
  return { skillDirs, commandFiles };
}
