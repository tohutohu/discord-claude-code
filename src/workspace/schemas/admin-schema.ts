import { z } from "zod";

// Admin状態のスキーマ
export const AdminStateSchema = z.object({
  activeThreadIds: z.array(z.string().min(1).max(100).regex(/^\d+$/)), // Discord thread IDの配列
  lastUpdated: z.string().datetime(),
});

// Worker状態のdevcontainer設定スキーマ
export const DevcontainerConfigSchema = z.object({
  useDevcontainer: z.boolean(),
  useFallbackDevcontainer: z.boolean(),
  hasDevcontainerFile: z.boolean(),
  hasAnthropicsFeature: z.boolean(),
  containerId: z.string().optional(),
  isStarted: z.boolean(),
});

// Repositoryスキーマ
export const RepositorySchema = z.object({
  fullName: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  org: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
});

// QueuedMessageスキーマ
export const QueuedMessageSchema = z.object({
  messageId: z.string().min(1).max(100),
  content: z.string().min(1).max(4000), // Discord message limit
  timestamp: z.number().positive(),
  authorId: z.string().min(1).max(100),
});

// Worker状態のスキーマ
export const WorkerStateSchema = z.object({
  workerName: z.string().min(1).max(100),
  threadId: z.string().min(1).max(100).regex(/^\d+$/),
  threadName: z.string().min(1).max(100).optional(),
  repository: RepositorySchema.optional(),
  repositoryLocalPath: z.string().optional(),
  worktreePath: z.string().nullable().optional(),
  devcontainerConfig: DevcontainerConfigSchema,
  sessionId: z.string().nullable().optional(),
  status: z.enum(["active", "inactive", "archived"]),
  rateLimitTimestamp: z.number().positive().optional(),
  autoResumeAfterRateLimit: z.boolean().optional(),
  queuedMessages: z.array(QueuedMessageSchema).optional(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
});

// 型定義をスキーマから生成
export type AdminState = z.infer<typeof AdminStateSchema>;
export type WorkerState = z.infer<typeof WorkerStateSchema>;
export type DevcontainerConfig = z.infer<typeof DevcontainerConfigSchema>;
export type Repository = z.infer<typeof RepositorySchema>;
export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

// バリデーション関数
export function validateAdminState(data: unknown): AdminState {
  return AdminStateSchema.parse(data);
}

export function validateAdminStateSafe(
  data: unknown,
): z.SafeParseReturnType<unknown, AdminState> {
  return AdminStateSchema.safeParse(data);
}

export function validateWorkerState(data: unknown): WorkerState {
  return WorkerStateSchema.parse(data);
}

export function validateWorkerStateSafe(
  data: unknown,
): z.SafeParseReturnType<unknown, WorkerState> {
  return WorkerStateSchema.safeParse(data);
}
