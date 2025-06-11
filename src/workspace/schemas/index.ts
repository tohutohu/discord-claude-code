// 各スキーマモジュールからエクスポート
export * from "./thread-schema.ts";
export * from "./session-schema.ts";
export * from "./audit-schema.ts";
export * from "./admin-schema.ts";
export * from "./pat-schema.ts";
export * from "./queue-schema.ts";

// WorkspaceConfig スキーマ
import { z } from "zod";

export const WorkspaceConfigSchema = z.object({
  baseDir: z.string().min(1),
  repositoriesDir: z.string().min(1),
  threadsDir: z.string().min(1),
  sessionsDir: z.string().min(1),
  auditDir: z.string().min(1),
  worktreesDir: z.string().min(1),
  patsDir: z.string().min(1),
  queuedMessagesDir: z.string().min(1),
  adminDir: z.string().min(1),
  workersDir: z.string().min(1),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// 共通のバリデーションユーティリティ
export function parseJsonSafe<T>(
  json: string,
  schema: z.ZodSchema<T>,
): z.SafeParseReturnType<unknown, T> {
  try {
    const data = JSON.parse(json);
    return schema.safeParse(data);
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          message: `JSON parse error: ${error}`,
          path: [],
        },
      ]),
    };
  }
}

// JSONL形式のバリデーション
export function parseJsonlSafe<T>(
  jsonl: string,
  schema: z.ZodSchema<T>,
): z.SafeParseReturnType<unknown, T[]> {
  try {
    const lines = jsonl.trim().split("\n").filter((line) => line.length > 0);
    const items: T[] = [];
    const errors: z.ZodIssue[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const data = JSON.parse(lines[i]);
        const result = schema.safeParse(data);
        if (result.success) {
          items.push(result.data);
        } else {
          errors.push({
            code: "custom",
            message: `Line ${i + 1}: ${result.error.message}`,
            path: [i],
          });
        }
      } catch (error) {
        errors.push({
          code: "custom",
          message: `Line ${i + 1}: JSON parse error: ${error}`,
          path: [i],
        });
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: new z.ZodError(errors),
      };
    }

    return {
      success: true,
      data: items,
    };
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          message: `JSONL parse error: ${error}`,
          path: [],
        },
      ]),
    };
  }
}
