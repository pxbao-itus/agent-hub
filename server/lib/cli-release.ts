import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const CLI_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_PATH_PATTERN = /^cli-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SKILL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const PUBLIC_RELEASE_ROOT = "/releases/cli";

type CliReleaseManifest = {
  schemaVersion: 1;
  version: string;
  channel: "preview" | "stable";
  releasePath: string;
  assets: {
    darwinArm64: string;
    darwinAmd64: string;
    checksums: string;
    installer: string;
  };
};

export type CliReleaseConfig =
  | {
      configured: false;
    }
  | {
      configured: true;
      version: string;
      channel: "preview" | "stable";
      baseUrl: string;
      installScriptUrl: string;
      checksumsUrl: string;
      manifestUrl: string;
      archives: {
        arm64: { name: string; url: string };
        amd64: { name: string; url: string };
      };
    };

type LoadCliReleaseOptions = {
  publicDirectory?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
}

function parseManifest(value: unknown): CliReleaseManifest | null {
  if (!isRecord(value) || !isRecord(value.assets)) return null;

  const manifest = value as Record<string, unknown> & {
    assets: Record<string, unknown>;
  };
  if (
    !hasExactKeys(manifest, [
      "assets",
      "channel",
      "releasePath",
      "schemaVersion",
      "version",
    ]) ||
    !hasExactKeys(manifest.assets, [
      "checksums",
      "darwinAmd64",
      "darwinArm64",
      "installer",
    ]) ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.version !== "string" ||
    !CLI_VERSION_PATTERN.test(manifest.version) ||
    (manifest.channel !== "preview" && manifest.channel !== "stable") ||
    typeof manifest.releasePath !== "string" ||
    !RELEASE_PATH_PATTERN.test(manifest.releasePath) ||
    manifest.releasePath !== `cli-v${manifest.version}`
  ) {
    return null;
  }

  const expectedAssets = {
    darwinArm64: `agenthub_${manifest.version}_darwin_arm64.tar.gz`,
    darwinAmd64: `agenthub_${manifest.version}_darwin_amd64.tar.gz`,
    checksums: "checksums.txt",
    installer: "install.sh",
  } as const;
  for (const [key, expected] of Object.entries(expectedAssets)) {
    if (manifest.assets[key] !== expected) return null;
  }

  return {
    schemaVersion: 1,
    version: manifest.version,
    channel: manifest.channel,
    releasePath: manifest.releasePath,
    assets: expectedAssets,
  };
}

function isSafeRegularFile(filePath: string, rootRealPath: string): boolean {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const resolved = realpathSync(filePath);
    return resolved.startsWith(`${rootRealPath}${path.sep}`);
  } catch {
    return false;
  }
}

export function loadCliReleaseConfig(
  options: LoadCliReleaseOptions = {},
): CliReleaseConfig {
  const publicDirectory = options.publicDirectory ?? path.join(process.cwd(), "public");
  const releaseRoot = path.join(publicDirectory, "releases", "cli");
  const manifestPath = path.join(releaseRoot, "release.json");

  let manifest: CliReleaseManifest | null = null;
  let rootRealPath: string;
  try {
    const rootStat = lstatSync(releaseRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { configured: false };
    }
    rootRealPath = realpathSync(releaseRoot);
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
      return { configured: false };
    }
    manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch {
    return { configured: false };
  }
  if (!manifest) return { configured: false };

  const releaseDirectory = path.join(releaseRoot, manifest.releasePath);
  try {
    const releaseStat = lstatSync(releaseDirectory);
    if (!releaseStat.isDirectory() || releaseStat.isSymbolicLink()) {
      return { configured: false };
    }
  } catch {
    return { configured: false };
  }
  const assetPaths = Object.values(manifest.assets).map((asset) =>
    path.join(releaseDirectory, asset),
  );
  if (!assetPaths.every((assetPath) => isSafeRegularFile(assetPath, rootRealPath))) {
    return { configured: false };
  }

  const baseUrl = `${PUBLIC_RELEASE_ROOT}/${manifest.releasePath}`;
  const assetUrl = (name: string) => `${baseUrl}/${name}`;
  return {
    configured: true,
    version: manifest.version,
    channel: manifest.channel,
    baseUrl,
    installScriptUrl: assetUrl(manifest.assets.installer),
    checksumsUrl: assetUrl(manifest.assets.checksums),
    manifestUrl: `${PUBLIC_RELEASE_ROOT}/release.json`,
    archives: {
      arm64: {
        name: manifest.assets.darwinArm64,
        url: assetUrl(manifest.assets.darwinArm64),
      },
      amd64: {
        name: manifest.assets.darwinAmd64,
        url: assetUrl(manifest.assets.darwinAmd64),
      },
    },
  };
}

export function normalizeCliSkillSlug(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return SKILL_SLUG_PATTERN.test(trimmed) ? trimmed : null;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}
