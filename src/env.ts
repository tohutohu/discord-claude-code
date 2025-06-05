import { load } from "std/dotenv/mod.ts";

export interface Env {
  DISCORD_TOKEN: string;
  WORK_BASE_DIR: string;
}

export async function getEnv(): Promise<Env> {
  // .envファイルを読み込み
  await load({ export: true });

  const token = Deno.env.get("DISCORD_TOKEN");
  const workBaseDir = Deno.env.get("WORK_BASE_DIR");

  if (!token) {
    throw new Error("DISCORD_TOKEN is not set");
  }

  if (!workBaseDir) {
    throw new Error("WORK_BASE_DIR is not set");
  }

  return {
    DISCORD_TOKEN: token,
    WORK_BASE_DIR: workBaseDir,
  };
}
