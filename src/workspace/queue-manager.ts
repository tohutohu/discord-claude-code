import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import type { QueuedMessage, ThreadQueue } from "../workspace.ts";
import { validateThreadQueueSafe } from "./schemas/queue-schema.ts";

export class QueueManager {
  private readonly queuedMessagesDir: string;

  constructor(baseDir: string) {
    this.queuedMessagesDir = join(baseDir, "queued_messages");
  }

  async initialize(): Promise<void> {
    await ensureDir(this.queuedMessagesDir);
  }

  private getQueueFilePath(threadId: string): string {
    return join(this.queuedMessagesDir, `${threadId}.json`);
  }

  async saveMessageQueue(threadQueue: ThreadQueue): Promise<void> {
    const filePath = this.getQueueFilePath(threadQueue.threadId);
    await Deno.writeTextFile(filePath, JSON.stringify(threadQueue, null, 2));
  }

  async loadMessageQueue(threadId: string): Promise<ThreadQueue | null> {
    try {
      const filePath = this.getQueueFilePath(threadId);
      const content = await Deno.readTextFile(filePath);
      const result = validateThreadQueueSafe(JSON.parse(content));
      if (!result.success) {
        throw new Error(
          `Invalid message queue for thread ${threadId}: ${result.error}`,
        );
      }
      return result.data;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return null;
      }
      throw error;
    }
  }

  async addMessageToQueue(
    threadId: string,
    message: QueuedMessage,
  ): Promise<void> {
    let queue = await this.loadMessageQueue(threadId);
    if (!queue) {
      queue = {
        threadId,
        messages: [],
      };
    }

    queue.messages.push(message);
    await this.saveMessageQueue(queue);
  }

  async getAndClearMessageQueue(threadId: string): Promise<QueuedMessage[]> {
    const queue = await this.loadMessageQueue(threadId);
    if (!queue || queue.messages.length === 0) {
      return [];
    }

    const messages = queue.messages;

    // キューをクリア
    await this.deleteMessageQueue(threadId);

    return messages;
  }

  async deleteMessageQueue(threadId: string): Promise<void> {
    const filePath = this.getQueueFilePath(threadId);
    try {
      await Deno.remove(filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async getQueueLength(threadId: string): Promise<number> {
    const queue = await this.loadMessageQueue(threadId);
    return queue ? queue.messages.length : 0;
  }

  async getAllQueues(): Promise<ThreadQueue[]> {
    try {
      const queues: ThreadQueue[] = [];

      for await (const entry of Deno.readDir(this.queuedMessagesDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const threadId = entry.name.replace(".json", "");
          const queue = await this.loadMessageQueue(threadId);
          if (queue) {
            queues.push(queue);
          }
        }
      }

      return queues.sort((a, b) => b.messages.length - a.messages.length);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async removeOldMessages(threadId: string, maxAgeMs: number): Promise<number> {
    const queue = await this.loadMessageQueue(threadId);
    if (!queue || queue.messages.length === 0) {
      return 0;
    }

    const now = Date.now();
    const originalLength = queue.messages.length;

    queue.messages = queue.messages.filter(
      (msg) => (now - msg.timestamp) < maxAgeMs,
    );

    const removedCount = originalLength - queue.messages.length;

    if (removedCount > 0) {
      if (queue.messages.length > 0) {
        await this.saveMessageQueue(queue);
      } else {
        await this.deleteMessageQueue(threadId);
      }
    }

    return removedCount;
  }

  async cleanupEmptyQueues(): Promise<string[]> {
    const allQueues = await this.getAllQueues();
    const deletedThreadIds: string[] = [];

    for (const queue of allQueues) {
      if (queue.messages.length === 0) {
        await this.deleteMessageQueue(queue.threadId);
        deletedThreadIds.push(queue.threadId);
      }
    }

    return deletedThreadIds;
  }
}
