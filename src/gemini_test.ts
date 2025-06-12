import { assertEquals } from "std/assert/mod.ts";
import { generateThreadName, summarizeWithGemini } from "./gemini.ts";

Deno.test("generateThreadName - リポジトリ名からオーナー部分を除去して結合", () => {
  const result = generateThreadName("テスト機能の実装", "owner/repo");
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value, "テスト機能の実装(repo)");
  }
});

Deno.test("generateThreadName - オーナーなしのリポジトリ名でも動作", () => {
  const result = generateThreadName("バグ修正", "repo");
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value, "バグ修正(repo)");
  }
});

Deno.test("generateThreadName - リポジトリ名なしの場合は要約のみを返す", () => {
  const result = generateThreadName("新機能の追加");
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value, "新機能の追加");
  }
});

Deno.test("generateThreadName - リポジトリ名がundefinedの場合も要約のみを返す", () => {
  const result = generateThreadName("テストコードの改善", undefined);
  assertEquals(result.isOk(), true);
  if (result.isOk()) {
    assertEquals(result.value, "テストコードの改善");
  }
});

Deno.test("summarizeWithGemini - API失敗時にエラーを返す", async () => {
  // 無効なAPIキーでテスト
  const result = await summarizeWithGemini("invalid-key", "テストメッセージ");
  assertEquals(result.isErr(), true);
  if (result.isErr()) {
    assertEquals(result.error.type, "API_REQUEST_FAILED");
  }
});

Deno.test("summarizeWithGemini - APIキーが設定されていない場合にエラーを返す", async () => {
  const result = await summarizeWithGemini("", "テストメッセージ");
  assertEquals(result.isErr(), true);
  if (result.isErr()) {
    assertEquals(result.error.type, "API_KEY_NOT_SET");
  }
});
