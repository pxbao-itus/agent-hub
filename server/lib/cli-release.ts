const CLI_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SKILL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;

export type CliReleaseConfig =
  | {
      configured: false;
    }
  | {
      configured: true;
      version: string;
      baseUrl: string;
      installScriptUrl: string;
      checksumsUrl: string;
      releaseNotesUrl: string;
      archives: {
        arm64: { name: string; url: string };
        amd64: { name: string; url: string };
      };
    };

function releaseNotesUrl(base: URL, version: string): string {
  const marker = `/releases/download/cli-v${version}`;
  if (base.hostname === "github.com" && base.pathname.endsWith(marker)) {
    const notes = new URL(base);
    notes.pathname = `${base.pathname.slice(0, -marker.length)}/releases/tag/cli-v${version}`;
    return notes.toString().replace(/\/$/, "");
  }
  return base.toString().replace(/\/$/, "");
}

export function loadCliReleaseConfig(
  env: Record<string, string | undefined> = process.env,
): CliReleaseConfig {
  const version = env.CLI_RELEASE_VERSION?.trim();
  const rawBaseUrl = env.CLI_RELEASE_BASE_URL?.trim();
  if (!version || !rawBaseUrl || !CLI_VERSION_PATTERN.test(version)) {
    return { configured: false };
  }

  let base: URL;
  try {
    base = new URL(rawBaseUrl);
  } catch {
    return { configured: false };
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    return { configured: false };
  }
  base.pathname = base.pathname.replace(/\/+$/, "");
  if (!base.pathname.endsWith(`/cli-v${version}`)) {
    return { configured: false };
  }

  const baseUrl = base.toString().replace(/\/$/, "");
  const archive = (arch: "arm64" | "amd64") => {
    const name = `agent-hub_${version}_darwin_${arch}.tar.gz`;
    return { name, url: `${baseUrl}/${name}` };
  };
  return {
    configured: true,
    version,
    baseUrl,
    installScriptUrl: `${baseUrl}/install.sh`,
    checksumsUrl: `${baseUrl}/checksums.txt`,
    releaseNotesUrl: releaseNotesUrl(base, version),
    archives: {
      arm64: archive("arm64"),
      amd64: archive("amd64"),
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
