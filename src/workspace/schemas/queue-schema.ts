import { z } from "zod";
import { QueuedMessageSchema } from "./admin-schema.ts";

// スレッドキューのスキーマ
export const ThreadQueueSchema = z.object({
  threadId: z.string().min(1).max(100).regex(/^\d+$/), // Discord thread ID
  messages: z.array(QueuedMessageSchema),
});

// 型定義をスキーマから生成
export type ThreadQueue = z.infer<typeof ThreadQueueSchema>;
// QueuedMessageはadmin-schema.tsからインポートされているので、再エクスポートしない

// バリデーション関数
export function validateThreadQueue(data: unknown): ThreadQueue {
  return ThreadQueueSchema.parse(data);
}

export function validateThreadQueueSafe(
  data: unknown,
): z.SafeParseReturnType<unknown, ThreadQueue> {
  return ThreadQueueSchema.safeParse(data);
}

// メッセージの最大保持数
export const MAX_QUEUED_MESSAGES = 100;

// キューサイズの検証
export function validateQueueSize(queue: ThreadQueue): boolean {
  return queue.messages.length <= MAX_QUEUED_MESSAGES;
}
