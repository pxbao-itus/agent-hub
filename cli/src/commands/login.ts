import { saveConfig } from "../config.js";

export async function loginCommand(args: string[]): Promise<void> {
  const [baseUrl, token] = args;
  if (!baseUrl || !token) {
    throw new Error("Usage: agent-hub login <base-url> <token>");
  }
  await saveConfig({ baseUrl, token });
  console.log(`Logged in to ${baseUrl}. Config saved to ~/.agent-hub/config.json.`);
}
