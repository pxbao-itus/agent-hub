import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type CliConfig = {
  baseUrl: string;
  token: string;
};

const CONFIG_DIR = join(homedir(), ".agent-hub");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export async function loadConfig(): Promise<CliConfig> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(`Not logged in — run \`agent-hub login <base-url> <token>\` first (expected config at ${CONFIG_PATH}).`);
  }
  return JSON.parse(raw) as CliConfig;
}
