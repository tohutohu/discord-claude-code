import { load } from "std/dotenv/mod.ts";

export interface Env {
  DISCORD_TOKEN: string;
}

export async function getEnv(): Promise<Env> {
  // .envファイルを読み込み
  await load({ export: true });

  const token = Deno.env.get("DISCORD_TOKEN");

  if (!token) {
    throw new Error("DISCORD_TOKEN is not set");
  }

  return {
    DISCORD_TOKEN: token,
  };
}
