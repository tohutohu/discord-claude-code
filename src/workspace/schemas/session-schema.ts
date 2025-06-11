import { z } from "zod";

// セッションログのタイプ
export const SessionLogTypeSchema = z.enum([
  "request",
  "response",
  "error",
  "session",
]);

// セッションログのスキーマ
export const SessionLogSchema = z.object({
  timestamp: z.string().datetime(),
  sessionId: z.string().min(1).max(100),
  type: SessionLogTypeSchema,
  content: z.string(),
});

// 型定義をスキーマから生成
export type SessionLog = z.infer<typeof SessionLogSchema>;
export type SessionLogType = z.infer<typeof SessionLogTypeSchema>;

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
