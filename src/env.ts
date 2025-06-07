export interface Env {
  DISCORD_TOKEN: string;
  WORK_BASE_DIR: string;
  VERBOSE?: boolean;
  CLAUDE_APPEND_SYSTEM_PROMPT?: string;
}

export function getEnv(): Env {
  const token = Deno.env.get("DISCORD_TOKEN");
  const workBaseDir = Deno.env.get("WORK_BASE_DIR");
  const verbose = Deno.env.get("VERBOSE") === "true";
  const claudeAppendSystemPrompt = Deno.env.get("CLAUDE_APPEND_SYSTEM_PROMPT");

  if (!token) {
    throw new Error("DISCORD_TOKEN is not set");
  }

  if (!workBaseDir) {
    throw new Error("WORK_BASE_DIR is not set");
  }

  return {
    DISCORD_TOKEN: token,
    WORK_BASE_DIR: workBaseDir,
    VERBOSE: verbose,
    CLAUDE_APPEND_SYSTEM_PROMPT: claudeAppendSystemPrompt,
  };
}
