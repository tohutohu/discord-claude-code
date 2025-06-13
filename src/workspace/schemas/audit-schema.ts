import { z } from "zod";

// 監査ログのアクションタイプ（拡張可能）
export const AuditActionSchema = z.string().min(1).max(100);

// 監査ログエントリのスキーマ
export const AuditEntrySchema = z.object({
  timestamp: z.string().datetime(),
  threadId: z.string().min(1).max(100),
  action: AuditActionSchema,
  details: z.record(z.unknown()), // 任意のキーバリューペア
});

// よく使われるアクションタイプの定数
export const AUDIT_ACTIONS = {
  WORKER_CREATED: "worker_created",
  WORKER_CLOSED: "worker_closed",
  WORKER_STOPPED: "worker_stopped",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_QUEUED: "message_queued",
  MESSAGE_QUEUE_CLEARED: "message_queue_cleared",
  SAVE_REPOSITORY_PAT: "save_repository_pat",
  DELETE_REPOSITORY_PAT: "delete_repository_pat",
  RATE_LIMIT_TRIGGERED: "rate_limit_triggered",
  RATE_LIMIT_RESUMED: "rate_limit_resumed",
  DEVCONTAINER_STARTED: "devcontainer_started",
  DEVCONTAINER_STOPPED: "devcontainer_stopped",
} as const;

// 型定義をスキーマから生成
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// バリデーション関数
export function validateAuditEntry(data: unknown): AuditEntry {
  return AuditEntrySchema.parse(data);
}

export function validateAuditEntrySafe(
  data: unknown,
): z.SafeParseReturnType<unknown, AuditEntry> {
  return AuditEntrySchema.safeParse(data);
}
