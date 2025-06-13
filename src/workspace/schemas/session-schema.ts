import { z } from "zod";

// セッションログのタイプ
export const SessionLogTypeSchema = z.enum([
  "request",
  "response",
  "error",
  "session",
  "interruption",
]);

// 中断理由のタイプ
export const InterruptionReasonSchema = z.enum([
  "user_requested",
  "timeout",
  "system_error",
]);

// 中断情報のスキーマ
export const InterruptionInfoSchema = z.object({
  reason: InterruptionReasonSchema,
  executionTime: z.number().optional(), // ミリ秒単位の実行時間
  lastActivity: z.string().optional(), // 最後のアクティビティ
});

// セッションログのスキーマ
export const SessionLogSchema = z.object({
  timestamp: z.string().datetime(),
  sessionId: z.string().min(1).max(100),
  type: SessionLogTypeSchema,
  content: z.string(),
  interruption: InterruptionInfoSchema.optional(), // 中断情報（interruption typeの場合のみ）
});

// 型定義をスキーマから生成
export type SessionLog = z.infer<typeof SessionLogSchema>;
export type SessionLogType = z.infer<typeof SessionLogTypeSchema>;
export type InterruptionReason = z.infer<typeof InterruptionReasonSchema>;
export type InterruptionInfo = z.infer<typeof InterruptionInfoSchema>;

// バリデーション関数
export function validateSessionLog(data: unknown): SessionLog {
  return SessionLogSchema.parse(data);
}

export function validateSessionLogSafe(
  data: unknown,
): z.SafeParseReturnType<unknown, SessionLog> {
  return SessionLogSchema.safeParse(data);
}

// セッションログの配列をバリデート
export function validateSessionLogs(data: unknown): SessionLog[] {
  return z.array(SessionLogSchema).parse(data);
}
