import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import type { ThreadInfo } from "../workspace.ts";
import { createWorktreeCopy, isWorktreeCopyExists } from "../git-utils.ts";
import { validateThreadInfoSafe } from "./schemas/thread-schema.ts";

export class ThreadManager {
  private readonly threadsDir: string;
  private readonly worktreesDir: string;

  constructor(baseDir: string) {
    this.threadsDir = join(baseDir, "threads");
    this.worktreesDir = join(baseDir, "worktrees");
  }

  async initialize(): Promise<void> {
    await ensureDir(this.threadsDir);
    await ensureDir(this.worktreesDir);
  }

  private getThreadFilePath(threadId: string): string {
    return join(this.threadsDir, `${threadId}.json`);
  }

  getWorktreePath(threadId: string): string {
    return join(this.worktreesDir, threadId);
  }

  async saveThreadInfo(threadInfo: ThreadInfo): Promise<void> {
    const filePath = this.getThreadFilePath(threadInfo.threadId);
    await Deno.writeTextFile(filePath, JSON.stringify(threadInfo, null, 2));
  }

  async loadThreadInfo(threadId: string): Promise<ThreadInfo | null> {
    try {
      const filePath = this.getThreadFilePath(threadId);
      const content = await Deno.readTextFile(filePath);
      const result = validateThreadInfoSafe(JSON.parse(content));
      if (!result.success) {
        throw new Error(`Invalid thread info for ${threadId}: ${result.error}`);
      }
      return result.data;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async updateThreadLastActive(threadId: string): Promise<void> {
    const threadInfo = await this.loadThreadInfo(threadId);
    if (threadInfo) {
      threadInfo.lastActiveAt = new Date().toISOString();
      await this.saveThreadInfo(threadInfo);
    }
  }

  async getAllThreadInfos(): Promise<ThreadInfo[]> {
    try {
      const threadInfos: ThreadInfo[] = [];

      for await (const entry of Deno.readDir(this.threadsDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const threadId = entry.name.replace(".json", "");
          const threadInfo = await this.loadThreadInfo(threadId);
          if (threadInfo) {
            threadInfos.push(threadInfo);
          }
        }
      }

      return threadInfos.sort((a, b) =>
        b.lastActiveAt.localeCompare(a.lastActiveAt)
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async ensureWorktree(
    threadId: string,
    repositoryPath: string,
  ): Promise<string> {
    const worktreePath = this.getWorktreePath(threadId);
    const exists = await isWorktreeCopyExists(worktreePath);
    if (exists) {
      return worktreePath;
    }

    await createWorktreeCopy(repositoryPath, threadId, worktreePath);
    return worktreePath;
  }

  async removeWorktree(threadId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(threadId);

    try {
      const stat = await Deno.stat(worktreePath);
      if (!stat.isDirectory) {
        return;
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return;
      }
      throw error;
    }

    try {
      await Deno.remove(worktreePath, { recursive: true });
    } catch (removeError) {
      console.warn(
        `ディレクトリの強制削除に失敗しました (${threadId}): ${removeError}`,
      );
    }
  }

  async cleanupWorktree(threadId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(threadId);

    try {
      await Deno.remove(worktreePath, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(
          `worktreeコピーディレクトリの削除に失敗しました: ${error}`,
        );
      }
    }
  }
}
