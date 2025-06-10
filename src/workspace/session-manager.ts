import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";

export interface SessionLog {
  timestamp: string;
  sessionId: string;
  type: "request" | "response" | "error" | "session";
  content: string;
}

export class SessionManager {
  private readonly sessionsDir: string;

  constructor(baseDir: string) {
    this.sessionsDir = join(baseDir, "sessions");
  }

  async initialize(): Promise<void> {
    await ensureDir(this.sessionsDir);
  }

  private getRepositorySessionDirPath(repositoryFullName: string): string {
    return join(this.sessionsDir, repositoryFullName);
  }

  private getRawSessionFilePath(
    repositoryFullName: string,
    timestamp: string,
    sessionId: string,
  ): string {
    return join(
      this.getRepositorySessionDirPath(repositoryFullName),
      `${timestamp}_${sessionId}.jsonl`,
    );
  }

  async saveRawSessionJsonl(
    repositoryFullName: string,
    sessionId: string,
    rawJsonlContent: string,
  ): Promise<void> {
    const repositorySessionDir = this.getRepositorySessionDirPath(
      repositoryFullName,
    );
    await ensureDir(repositorySessionDir);

    // 既存のファイルを探す
    let existingFilePath: string | null = null;
    try {
      for await (const entry of Deno.readDir(repositorySessionDir)) {
        if (entry.isFile && entry.name.endsWith(`_${sessionId}.jsonl`)) {
          existingFilePath = join(repositorySessionDir, entry.name);
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    let filePath: string;
    if (existingFilePath) {
      // 既存ファイルに追記
      filePath = existingFilePath;
      await Deno.writeTextFile(filePath, "\n" + rawJsonlContent, {
        append: true,
      });
    } else {
      // 新規ファイル作成
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      filePath = this.getRawSessionFilePath(
        repositoryFullName,
        timestamp,
        sessionId,
      );
      await Deno.writeTextFile(filePath, rawJsonlContent);
    }
  }

  async loadSessionLogs(
    repositoryFullName: string,
    sessionId: string,
  ): Promise<SessionLog[]> {
    const repositorySessionDir = this.getRepositorySessionDirPath(
      repositoryFullName,
    );

    try {
      // セッションIDを含むファイルを探す
      let sessionFilePath: string | null = null;
      for await (const entry of Deno.readDir(repositorySessionDir)) {
        if (entry.isFile && entry.name.endsWith(`_${sessionId}.jsonl`)) {
          sessionFilePath = join(repositorySessionDir, entry.name);
          break;
        }
      }

      if (!sessionFilePath) {
        return [];
      }

      const content = await Deno.readTextFile(sessionFilePath);
      const lines = content.trim().split("\n").filter((line) =>
        line.length > 0
      );

      return lines.map((line) => JSON.parse(line) as SessionLog);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async getSessionIds(repositoryFullName: string): Promise<string[]> {
    const repositorySessionDir = this.getRepositorySessionDirPath(
      repositoryFullName,
    );

    try {
      const sessionIds = new Set<string>();

      for await (const entry of Deno.readDir(repositorySessionDir)) {
        if (entry.isFile && entry.name.endsWith(".jsonl")) {
          // ファイル名から sessionId を抽出 (timestamp_sessionId.jsonl)
          const match = entry.name.match(/_([^_]+)\.jsonl$/);
          if (match) {
            sessionIds.add(match[1]);
          }
        }
      }

      return Array.from(sessionIds).sort();
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async deleteSessionLogs(
    repositoryFullName: string,
    sessionId: string,
  ): Promise<void> {
    const repositorySessionDir = this.getRepositorySessionDirPath(
      repositoryFullName,
    );

    try {
      for await (const entry of Deno.readDir(repositorySessionDir)) {
        if (entry.isFile && entry.name.endsWith(`_${sessionId}.jsonl`)) {
          const filePath = join(repositorySessionDir, entry.name);
          await Deno.remove(filePath);
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
}
