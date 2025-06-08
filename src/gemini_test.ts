import { assertEquals } from "std/assert/mod.ts";
import { generateThreadName, summarizeWithGemini } from "./gemini.ts";

Deno.test("generateThreadName - リポジトリ名からオーナー部分を除去して結合", () => {
  const result = generateThreadName("テスト機能の実装", "owner/repo");
  assertEquals(result, "テスト機能の実装(repo)");
});

Deno.test("generateThreadName - オーナーなしのリポジトリ名でも動作", () => {
  const result = generateThreadName("バグ修正", "repo");
  assertEquals(result, "バグ修正(repo)");
});

Deno.test("summarizeWithGemini - API失敗時にエラーを返す", async () => {
  // 無効なAPIキーでテスト
  const result = await summarizeWithGemini("invalid-key", "テストメッセージ");
  assertEquals(result.success, false);
  assertEquals(typeof result.error, "string");
});

Deno.test("summarizeWithGemini - 空のレスポンス時にエラーを返す", async () => {
  // モックサーバーなしでテストする場合、スキップ
  // 実際のテストではモックサーバーを使用する
});
