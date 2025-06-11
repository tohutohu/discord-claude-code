import { z } from "zod";

// リポジトリPAT情報のスキーマ
export const RepositoryPatInfoSchema = z.object({
  repositoryFullName: z.string().min(1).max(200), // リポジトリフルネーム
  token: z.string().min(1).max(500), // GitHubトークンの長さ制限
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  description: z.string().max(1000).optional(),
});

// 型定義をスキーマから生成
export type RepositoryPatInfo = z.infer<typeof RepositoryPatInfoSchema>;

// バリデーション関数
export function validateRepositoryPatInfo(data: unknown): RepositoryPatInfo {
  return RepositoryPatInfoSchema.parse(data);
}

export function validateRepositoryPatInfoSafe(
  data: unknown,
): z.SafeParseReturnType<unknown, RepositoryPatInfo> {
  return RepositoryPatInfoSchema.safeParse(data);
}

// PAT情報の配列をバリデート
export function validateRepositoryPatInfos(data: unknown): RepositoryPatInfo[] {
  return z.array(RepositoryPatInfoSchema).parse(data);
}
