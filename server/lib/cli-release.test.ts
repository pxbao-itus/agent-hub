import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadCliReleaseConfig,
  normalizeCliSkillSlug,
  shellQuote,
} from "./cli-release";

const temporaryDirectories: string[] = [];

function releaseFixture(overrides: Record<string, unknown> = {}) {
  const publicDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-hub-cli-release-"));
  temporaryDirectories.push(publicDirectory);
  const root = path.join(publicDirectory, "releases", "cli");
  const releaseDirectory = path.join(root, "cli-v1.2.3");
  mkdirSync(releaseDirectory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    version: "1.2.3",
    channel: "preview",
    releasePath: "cli-v1.2.3",
    assets: {
      darwinArm64: "agenthub_1.2.3_darwin_arm64.tar.gz",
      darwinAmd64: "agenthub_1.2.3_darwin_amd64.tar.gz",
      checksums: "checksums.txt",
      installer: "install.sh",
    },
    ...overrides,
  };
  writeFileSync(path.join(root, "release.json"), `${JSON.stringify(manifest)}\n`);
  for (const asset of Object.values(manifest.assets)) {
    writeFileSync(path.join(releaseDirectory, asset), "fixture");
  }
  return { publicDirectory, root, releaseDirectory };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI release manifest", () => {
  it("loads immutable same-origin macOS release assets", () => {
    const { publicDirectory } = releaseFixture();
    expect(loadCliReleaseConfig({ publicDirectory })).toEqual({
      configured: true,
      version: "1.2.3",
      channel: "preview",
      baseUrl: "/releases/cli/cli-v1.2.3",
      installScriptUrl: "/releases/cli/cli-v1.2.3/install.sh",
      checksumsUrl: "/releases/cli/cli-v1.2.3/checksums.txt",
      manifestUrl: "/releases/cli/release.json",
      archives: {
        arm64: {
          name: "agenthub_1.2.3_darwin_arm64.tar.gz",
          url: "/releases/cli/cli-v1.2.3/agenthub_1.2.3_darwin_arm64.tar.gz",
        },
        amd64: {
          name: "agenthub_1.2.3_darwin_amd64.tar.gz",
          url: "/releases/cli/cli-v1.2.3/agenthub_1.2.3_darwin_amd64.tar.gz",
        },
      },
    });
  });

  it.each([
    { schemaVersion: 2 },
    { version: "v1.2.3" },
    { channel: "nightly" },
    { releasePath: "../cli-v1.2.3" },
    { releasePath: "cli-v9.9.9" },
    {
      assets: {
        darwinArm64: "../../outside.tar.gz",
        darwinAmd64: "agenthub_1.2.3_darwin_amd64.tar.gz",
        checksums: "checksums.txt",
        installer: "install.sh",
      },
    },
  ])("fails closed for invalid manifest data %#", (override) => {
    const { publicDirectory } = releaseFixture(override);
    expect(loadCliReleaseConfig({ publicDirectory })).toEqual({ configured: false });
  });

  it("fails closed when an asset is missing or symlinked", () => {
    const missing = releaseFixture();
    rmSync(path.join(missing.releaseDirectory, "checksums.txt"));
    expect(loadCliReleaseConfig({ publicDirectory: missing.publicDirectory })).toEqual({
      configured: false,
    });

    const linked = releaseFixture();
    const installer = path.join(linked.releaseDirectory, "install.sh");
    rmSync(installer);
    symlinkSync(path.join(linked.releaseDirectory, "checksums.txt"), installer);
    expect(loadCliReleaseConfig({ publicDirectory: linked.publicDirectory })).toEqual({
      configured: false,
    });
  });

  it("is unconfigured when release.json does not exist", () => {
    const publicDirectory = mkdtempSync(path.join(os.tmpdir(), "agent-hub-cli-empty-"));
    temporaryDirectories.push(publicDirectory);
    expect(loadCliReleaseConfig({ publicDirectory })).toEqual({ configured: false });
  });
});

describe("CLI contextual command helpers", () => {
  it("accepts canonical Skill slugs and rejects unsafe query values", () => {
    expect(normalizeCliSkillSlug("org.team.review-skill")).toBe("org.team.review-skill");
    expect(normalizeCliSkillSlug(["one", "two"])).toBeNull();
    expect(normalizeCliSkillSlug("skill'; rm -rf /")).toBeNull();
    expect(normalizeCliSkillSlug("x".repeat(241))).toBeNull();
  });

  it("quotes shell values without interpolation", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
  });
});
