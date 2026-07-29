import type { Metadata } from "next";
import Link from "next/link";
import {
  Apple,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  ExternalLink,
  KeyRound,
  Laptop,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import {
  loadCliReleaseConfig,
  normalizeCliSkillSlug,
  shellQuote,
} from "@/server/lib/cli-release";

export const metadata: Metadata = {
  title: "CLI",
  description: "Install Agent Hub CLI for native Claude and Codex Skills.",
};

type Props = {
  searchParams: Promise<{ skill?: string | string[] }>;
};

function applicationOrigin(): string {
  try {
    return new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

function manualInstallCommand(archiveName: string): string {
  return [
    `ARCHIVE="$HOME/Downloads/${archiveName}"`,
    'TEMP_DIR="$(mktemp -d)"',
    'tar -xzf "$ARCHIVE" -C "$TEMP_DIR"',
    'mkdir -p "$HOME/.local/bin"',
    'install -m 0755 "$TEMP_DIR/agenthub" "$HOME/.local/bin/agenthub"',
    'rm -rf "$TEMP_DIR"',
    'export PATH="$HOME/.local/bin:$PATH"',
    "agenthub version",
  ].join("\n");
}

export default async function CliPage({ searchParams }: Props) {
  const release = loadCliReleaseConfig();
  const { skill: skillParam } = await searchParams;
  const skill = normalizeCliSkillSlug(skillParam);
  const origin = applicationOrigin();
  const loginCommand = `agenthub login ${shellQuote(origin)} YOUR_TOKEN_HERE`;
  const secureReleaseOrigin = origin.startsWith("https://");
  const installCommand = release.configured && secureReleaseOrigin
    ? `curl -fsSL ${shellQuote(`${origin}${release.installScriptUrl}`)} | sh -s -- --release-base-url ${shellQuote(`${origin}${release.baseUrl}`)}`
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">Agent Hub CLI</h1>
          <Badge
            variant={
              release.configured && release.channel === "stable"
                ? "success"
                : "warning"
            }
          >
            {release.configured && release.channel === "stable" ? "Stable" : "Preview"}
          </Badge>
          {release.configured && (
            <Badge variant="outline">v{release.version}</Badge>
          )}
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Pull and mirror native Skills from Agent Hub into Claude Code or Codex.
          Install the CLI once, then run it from the project that should receive
          the Skills.
        </p>
      </header>

      <section aria-labelledby="platform-heading" className="space-y-3">
        <div>
          <h2 id="platform-heading" className="text-lg font-semibold">
            Choose your platform
          </h2>
          <p className="text-sm text-muted-foreground">
            macOS is available in Preview. Ubuntu and Windows support is planned.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3" role="list">
          <div
            role="listitem"
            aria-current="true"
            className="rounded-lg border border-primary bg-primary/5 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-medium">
                <Apple className="h-4 w-4" />
                macOS
              </span>
              <Badge variant={release.configured ? "success" : "secondary"}>
                {release.configured ? "Available" : "Setup required"}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Apple Silicon and Intel Mac
            </p>
          </div>
          {[
            { name: "Ubuntu", detail: "Linux packages are not published yet." },
            { name: "Windows", detail: "Windows binaries are not published yet." },
          ].map((platform) => (
            <div
              key={platform.name}
              role="button"
              aria-disabled="true"
              tabIndex={0}
              className="rounded-lg border bg-muted/20 p-4 opacity-70"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium">
                  <Laptop className="h-4 w-4" />
                  {platform.name}
                </span>
                <Badge variant="secondary">Coming soon</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{platform.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {!release.configured && (
        <Card className="border-warning/40 bg-warning/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">CLI downloads are not configured</CardTitle>
            <CardDescription>
              An administrator must place a valid release.json and its immutable
              release assets in public/releases/cli. You can still build the CLI
              from source using the public repository.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <SquareTerminal className="h-5 w-5" />
              <CardTitle>Install from terminal</CardTitle>
            </div>
            <CardDescription>
              Recommended. Detects Apple Silicon or Intel, verifies SHA-256 and
              installs to ~/.local/bin without sudo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {installCommand ? (
              <CodeBlock>{installCommand}</CodeBlock>
            ) : release.configured ? (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                Terminal installation requires this Agent Hub instance to use
                HTTPS. For local HTTP testing, download an archive and follow the
                manual installation steps.
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                Add a local CLI release manifest and assets to enable installation.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              The installer is unsigned Preview software. It never changes your
              shell profile or macOS security settings.
            </p>
            <p className="text-xs text-muted-foreground">
              Upgrading from a pre-0.2 release? After verifying{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                agenthub version
              </code>
              , you may remove the old binary with{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {'rm "$HOME/.local/bin/agent-hub"'}
              </code>
              .
            </p>
            {release.configured && (
              <Button asChild variant="ghost" size="sm">
                <a
                  href={release.installScriptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View installer source
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              <CardTitle>Download archive</CardTitle>
            </div>
            <CardDescription>
              Choose your Mac architecture, extract the archive and place
              agenthub somewhere in PATH.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {release.configured ? (
                <>
                  <Button asChild variant="outline">
                    <a href={release.archives.arm64.url}>
                      <Download className="h-4 w-4" />
                      Apple Silicon
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={release.archives.amd64.url}>
                      <Download className="h-4 w-4" />
                      Intel Mac
                    </a>
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" disabled>
                    Apple Silicon
                  </Button>
                  <Button variant="outline" disabled>
                    Intel Mac
                  </Button>
                </>
              )}
            </div>
            {release.configured && (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
                  <a
                    href={release.checksumsUrl}
                    className="text-primary hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    SHA-256 checksums
                  </a>
                  <a
                    href={release.manifestUrl}
                    className="text-primary hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Release manifest
                  </a>
                </div>

                <details className="group border-t pt-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Show manual installation steps
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="mt-3 space-y-4 px-2 pb-1">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Install a downloaded archive
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Run the command matching the archive you downloaded. It
                        installs the binary to ~/.local/bin without sudo. Update
                        ARCHIVE if your browser saved the file outside Downloads.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Apple Silicon</p>
                        <CodeBlock>
                          {manualInstallCommand(release.archives.arm64.name)}
                        </CodeBlock>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Intel Mac</p>
                        <CodeBlock>
                          {manualInstallCommand(release.archives.amd64.name)}
                        </CodeBlock>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      The export updates PATH for the current terminal. Add{" "}
                      <code className="rounded bg-muted px-1 py-0.5">
                        {'export PATH="$HOME/.local/bin:$PATH"'}
                      </code>{" "}
                      to ~/.zshrc to keep the command available in new terminals.
                    </p>
                  </div>
                </details>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="get-started-heading" className="space-y-4">
        <div>
          <h2 id="get-started-heading" className="text-lg font-semibold">
            Get started
          </h2>
          <p className="text-sm text-muted-foreground">
            Complete these steps after the binary is installed.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <StepCard number="1" title="Verify the installation">
            <CodeBlock>agenthub version</CodeBlock>
          </StepCard>
          <StepCard number="2" title="Create an MCP token">
            <p className="text-sm text-muted-foreground">
              The CLI uses the same scoped token and access rules as your agent.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/tokens">
                <KeyRound className="h-4 w-4" />
                Create or manage MCP token
              </Link>
            </Button>
          </StepCard>
          <StepCard number="3" title="Connect this Agent Hub">
            <CodeBlock>{loginCommand}</CodeBlock>
            <p className="text-xs text-muted-foreground">
              Replace the placeholder with a newly generated token. Do not save
              tokens in a repository or URL.
            </p>
          </StepCard>
          <StepCard number="4" title="Pull accessible Skills">
            <CodeBlock>
              {"# Claude Code (default)\nagenthub pull skill --all\n\n# Codex\nagenthub pull skill --all --target codex"}
            </CodeBlock>
          </StepCard>
        </div>
      </section>

      {skill && (
        <Card className="border-primary/30" id="skill-command">
          <CardHeader>
            <CardTitle>Use {skill} with the CLI</CardTitle>
            <CardDescription>
              Run one command from the project where the Skill should be installed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CodeBlock>
              {`# Claude Code (default)\nagenthub pull skill ${shellQuote(skill)}\n\n# Codex\nagenthub pull skill ${shellQuote(skill)} --target codex`}
            </CodeBlock>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle>Preview security and updates</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <p className="flex gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            Archives are checksum-verified before install.
          </p>
          <p className="flex gap-2">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
            Re-run the versioned installer to update.
          </p>
          <p className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            macOS binaries are not Apple-signed or notarized yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StepCard({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {number}
          </span>
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
