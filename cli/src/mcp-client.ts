import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CliConfig } from "./config.js";

export type SkillBundle = {
  schemaVersion: 1;
  kind: "skill";
  slug: string;
  title: string;
  description: string | null;
  body: string;
  files: { path: string; content: string; mimeType: string | null }[];
  versionNo: number;
  updatedAt: string;
};

export type KitBundle = {
  schemaVersion: 1;
  kind: "kit";
  slug: string;
  title: string;
  description: string | null;
  body: string;
  versionNo: number;
  updatedAt: string | null;
  prompts: { slug: string; title: string; description: string | null; body: string; versionNo: number; updatedAt: string }[];
  skills: SkillBundle[];
};

async function callPullTool(config: CliConfig, name: "pull_skill" | "pull_kit", slug: string): Promise<unknown> {
  const transport = new StreamableHTTPClientTransport(new URL("/api/mcp", config.baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  });
  const client = new Client({ name: "agent-hub-cli", version: "0.1.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name, arguments: { slug } });
    const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content.find((c) => c.type === "text")?.text;
    if (!text) throw new Error(`${name}('${slug}') returned no content.`);
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) throw new Error(parsed.error);
    return parsed;
  } finally {
    await client.close();
  }
}

export async function pullSkill(config: CliConfig, slug: string): Promise<SkillBundle> {
  return (await callPullTool(config, "pull_skill", slug)) as SkillBundle;
}

export async function pullKit(config: CliConfig, slug: string): Promise<KitBundle> {
  return (await callPullTool(config, "pull_kit", slug)) as KitBundle;
}
