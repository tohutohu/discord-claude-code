import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import type { QueuedMessage, ThreadQueue } from "./workspace.ts";
import { validateThreadQueueSafe } from "./schemas/queue-schema.ts";
import { err, ok, Result } from "neverthrow";
import type { WorkspaceError } from "./types.ts";

export class QueueManager {
  private readonly queuedMessagesDir: string;

  constructor(baseDir: string) {
    this.queuedMessagesDir = join(baseDir, "queued_messages");
  }

  async initialize(): Promise<Result<void, WorkspaceError>> {
    try {
      await ensureDir(this.queuedMessagesDir);
      return ok(undefined);
    } catch (error) {
      return err({
        type: "QUEUE_INITIALIZATION_FAILED",
        error: `QueueManagerの初期化に失敗しました: ${error}`,
      });
    }
  }

  private getQueueFilePath(threadId: string): string {
    return join(this.queuedMessagesDir, `${threadId}.json`);
  }

  async saveMessageQueue(
    threadQueue: ThreadQueue,
  ): Promise<Result<void, WorkspaceError>> {
    const filePath = this.getQueueFilePath(threadQueue.threadId);
    try {
      await Deno.writeTextFile(filePath, JSON.stringify(threadQueue, null, 2));
      return ok(undefined);
    } catch (error) {
      return err({
        type: "QUEUE_SAVE_FAILED",
        threadId: threadQueue.threadId,
        error: `メッセージキューの保存に失敗しました: ${error}`,
      });
    }
  }

  async loadMessageQueue(
    threadId: string,
  ): Promise<Result<ThreadQueue | null, WorkspaceError>> {
    try {
      const filePath = this.getQueueFilePath(threadId);
      const content = await Deno.readTextFile(filePath);

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        return err({
          type: "QUEUE_LOAD_FAILED",
          threadId,
          error: `メッセージキューのJSONパースに失敗しました: ${parseError}`,
        });
      }

      const result = validateThreadQueueSafe(parsed);
      if (!result.success) {
        return err({
          type: "QUEUE_LOAD_FAILED",
          threadId,
          error: `無効なメッセージキューデータ: ${result.error}`,
        });
      }
      return ok(result.data);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok(null);
      }
      return err({
        type: "QUEUE_LOAD_FAILED",
        threadId,
        error: `メッセージキューの読み込みに失敗しました: ${error}`,
      });
    }
  }

  async addMessageToQueue(
    threadId: string,
    message: QueuedMessage,
  ): Promise<Result<void, WorkspaceError>> {
    const loadResult = await this.loadMessageQueue(threadId);
    if (loadResult.isErr()) {
      return err(loadResult.error);
    }

    let queue = loadResult.value;
    if (!queue) {
      queue = {
        threadId,
        messages: [],
      };
    }

    queue.messages.push(message);
    return await this.saveMessageQueue(queue);
  }

  async getAndClearMessageQueue(
    threadId: string,
  ): Promise<Result<QueuedMessage[], WorkspaceError>> {
    const loadResult = await this.loadMessageQueue(threadId);
    if (loadResult.isErr()) {
      return err(loadResult.error);
    }

    const queue = loadResult.value;
    if (!queue || queue.messages.length === 0) {
      return ok([]);
    }

    const messages = queue.messages;

    // キューをクリア
    const deleteResult = await this.deleteMessageQueue(threadId);
    if (deleteResult.isErr()) {
      return err(deleteResult.error);
    }

    return ok(messages);
  }

  async deleteMessageQueue(
    threadId: string,
  ): Promise<Result<void, WorkspaceError>> {
    const filePath = this.getQueueFilePath(threadId);
    try {
      await Deno.remove(filePath);
      return ok(undefined);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok(undefined);
      }
      return err({
        type: "QUEUE_DELETE_FAILED",
        threadId,
        error: `メッセージキューの削除に失敗しました: ${error}`,
      });
    }
  }

  async getQueueLength(
    threadId: string,
  ): Promise<Result<number, WorkspaceError>> {
    const loadResult = await this.loadMessageQueue(threadId);
    if (loadResult.isErr()) {
      return err(loadResult.error);
    }

    const queue = loadResult.value;
    return ok(queue ? queue.messages.length : 0);
  }

  async getAllQueues(): Promise<Result<ThreadQueue[], WorkspaceError>> {
    try {
      const queues: ThreadQueue[] = [];

      for await (const entry of Deno.readDir(this.queuedMessagesDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const threadId = entry.name.replace(".json", "");
          const loadResult = await this.loadMessageQueue(threadId);
          if (loadResult.isErr()) {
            // 個別の読み込みエラーはスキップしてログのみ出力
            console.error(
              `メッセージキューの読み込みに失敗しました (${threadId}):`,
              loadResult.error,
            );
            continue;
          }
          if (loadResult.value) {
            queues.push(loadResult.value);
          }
        }
      }

      return ok(queues.sort((a, b) => b.messages.length - a.messages.length));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok([]);
      }
      return err({
        type: "QUEUE_LIST_FAILED",
        error: `メッセージキュー一覧の取得に失敗しました: ${error}`,
      });
    }
  }

  async removeOldMessages(
    threadId: string,
    maxAgeMs: number,
  ): Promise<Result<number, WorkspaceError>> {
    const loadResult = await this.loadMessageQueue(threadId);
    if (loadResult.isErr()) {
      return err(loadResult.error);
    }

    const queue = loadResult.value;
    if (!queue || queue.messages.length === 0) {
      return ok(0);
    }

    const now = Date.now();
    const originalLength = queue.messages.length;

    queue.messages = queue.messages.filter(
      (msg) => (now - msg.timestamp) < maxAgeMs,
    );

    const removedCount = originalLength - queue.messages.length;

    if (removedCount > 0) {
      if (queue.messages.length > 0) {
        const saveResult = await this.saveMessageQueue(queue);
        if (saveResult.isErr()) {
          return err(saveResult.error);
        }
      } else {
        const deleteResult = await this.deleteMessageQueue(threadId);
        if (deleteResult.isErr()) {
          return err(deleteResult.error);
        }
      }
    }

    return ok(removedCount);
  }

  async cleanupEmptyQueues(): Promise<Result<string[], WorkspaceError>> {
    const queuesResult = await this.getAllQueues();
    if (queuesResult.isErr()) {
      return err(queuesResult.error);
    }

    const allQueues = queuesResult.value;
    const deletedThreadIds: string[] = [];

    for (const queue of allQueues) {
      if (queue.messages.length === 0) {
        const deleteResult = await this.deleteMessageQueue(queue.threadId);
        if (deleteResult.isOk()) {
          deletedThreadIds.push(queue.threadId);
        } else {
          // 削除エラーはログに記録して続行
          console.error(
            `空のキュー削除エラー (${queue.threadId}):`,
            deleteResult.error,
          );
        }
      }
    }

    return ok(deletedThreadIds);
  }
}
