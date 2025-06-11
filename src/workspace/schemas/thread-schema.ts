import { z } from "zod";

// スレッドのステータス
export const ThreadStatusSchema = z.enum(["active", "inactive", "archived"]);

// スレッド情報のスキーマ
export const ThreadInfoSchema = z.object({
  threadId: z.string().min(1).max(100), // Discord thread ID
  repositoryFullName: z.string().min(1).max(200).nullable(), // リポジトリフルネーム
  repositoryLocalPath: z.string().nullable(),
  worktreePath: z.string().nullable(),
  createdAt: z.string().datetime(), // ISO 8601形式
  lastActiveAt: z.string().datetime(),
  status: ThreadStatusSchema,
});

// 型定義をスキーマから生成
export type ThreadInfo = z.infer<typeof ThreadInfoSchema>;
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

// バリデーション関数
export function validateThreadInfo(data: unknown): ThreadInfo {
  return ThreadInfoSchema.parse(data);
}

export function validateThreadInfoSafe(
  data: unknown,
): z.SafeParseReturnType<unknown, ThreadInfo> {
  return ThreadInfoSchema.safeParse(data);
}
