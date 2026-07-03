#!/usr/bin/env node
import { loginCommand } from "./commands/login.js";
import { pullCommand } from "./commands/pull.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "login":
      await loginCommand(rest);
      break;
    case "pull":
      await pullCommand(rest);
      break;
    case "sync":
      await syncCommand(rest);
      break;
    case "status":
      await statusCommand();
      break;
    default:
      console.error("Usage: agent-hub <login|pull|sync|status> ...");
      console.error("  agent-hub login <base-url> <token>");
      console.error("  agent-hub pull skill <slug>");
      console.error("  agent-hub pull kit <slug>");
      console.error("  agent-hub sync [--force]");
      console.error("  agent-hub status");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
