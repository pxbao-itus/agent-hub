import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSkillFromDisk, writeSkill } from "./fs-write.js";
import type { SkillBundle } from "./mcp-client.js";

function makeBundle(overrides: Partial<SkillBundle> = {}): SkillBundle {
  return {
    schemaVersion: 1,
    kind: "skill",
    slug: "test-skill",
    title: "Test skill",
    description: null,
    body: "# Test skill\n",
    files: [{ path: "checklist.md", content: "- [ ] item", mimeType: "text/markdown" }],
    versionNo: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("writeSkill / readSkillFromDisk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-hub-cli-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips body + bundled files", async () => {
    const bundle = makeBundle();
    await writeSkill(bundle, dir);

    const disk = await readSkillFromDisk(bundle.slug, dir);
    expect(disk?.body).toBe(bundle.body);
    expect(disk?.files).toEqual([{ path: "checklist.md", content: "- [ ] item" }]);
  });

  it("writes nested bundled file paths under their own subdirectories", async () => {
    const bundle = makeBundle({ files: [{ path: "scripts/run.sh", content: "echo hi", mimeType: null }] });
    await writeSkill(bundle, dir);

    const disk = await readSkillFromDisk(bundle.slug, dir);
    expect(disk?.files).toEqual([{ path: "scripts/run.sh", content: "echo hi" }]);
  });

  it("returns null for a skill that was never pulled", async () => {
    expect(await readSkillFromDisk("never-pulled", dir)).toBeNull();
  });

  it("refuses a bundled file path that escapes the skill directory", async () => {
    const bundle = makeBundle({ files: [{ path: "../../etc/passwd", content: "pwned", mimeType: null }] });
    await expect(writeSkill(bundle, dir)).rejects.toThrow(/escapes/);
  });

  it("refuses an absolute bundled file path", async () => {
    const bundle = makeBundle({ files: [{ path: "/etc/passwd", content: "pwned", mimeType: null }] });
    await expect(writeSkill(bundle, dir)).rejects.toThrow(/absolute/);
  });
});
