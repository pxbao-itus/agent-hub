import { describe, expect, it } from "vitest";
import {
  loadCliReleaseConfig,
  normalizeCliSkillSlug,
  shellQuote,
} from "./cli-release";

describe("CLI release configuration", () => {
  it("builds immutable macOS release assets", () => {
    const config = loadCliReleaseConfig({
      CLI_RELEASE_VERSION: "1.2.3",
      CLI_RELEASE_BASE_URL:
        "https://github.com/example/agent-hub/releases/download/cli-v1.2.3/",
    });
    expect(config).toEqual({
      configured: true,
      version: "1.2.3",
      baseUrl: "https://github.com/example/agent-hub/releases/download/cli-v1.2.3",
      installScriptUrl:
        "https://github.com/example/agent-hub/releases/download/cli-v1.2.3/install.sh",
      checksumsUrl:
        "https://github.com/example/agent-hub/releases/download/cli-v1.2.3/checksums.txt",
      releaseNotesUrl: "https://github.com/example/agent-hub/releases/tag/cli-v1.2.3",
      archives: {
        arm64: {
          name: "agent-hub_1.2.3_darwin_arm64.tar.gz",
          url: "https://github.com/example/agent-hub/releases/download/cli-v1.2.3/agent-hub_1.2.3_darwin_arm64.tar.gz",
        },
        amd64: {
          name: "agent-hub_1.2.3_darwin_amd64.tar.gz",
          url: "https://github.com/example/agent-hub/releases/download/cli-v1.2.3/agent-hub_1.2.3_darwin_amd64.tar.gz",
        },
      },
    });
  });

  it.each([
    {},
    { CLI_RELEASE_VERSION: "1.2.3" },
    {
      CLI_RELEASE_VERSION: "v1.2.3",
      CLI_RELEASE_BASE_URL: "https://example.com/releases/download/cli-v1.2.3",
    },
    {
      CLI_RELEASE_VERSION: "1.2.3",
      CLI_RELEASE_BASE_URL: "http://example.com/releases/download/cli-v1.2.3",
    },
    {
      CLI_RELEASE_VERSION: "1.2.3",
      CLI_RELEASE_BASE_URL: "https://user@example.com/releases/download/cli-v1.2.3",
    },
    {
      CLI_RELEASE_VERSION: "1.2.3",
      CLI_RELEASE_BASE_URL: "https://example.com/releases/download/latest",
    },
  ])("fails closed for invalid or partial configuration %#", (env) => {
    expect(loadCliReleaseConfig(env)).toEqual({ configured: false });
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
