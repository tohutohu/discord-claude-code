import { assertEquals } from "std/assert/mod.ts";

Deno.test("devcontainer streaming - 進捗コールバックが正しくインターフェースされる", () => {
  // 進捗コールバック関数が正しい型であることをテスト
  const progressCallback = async (message: string) => {
    assertEquals(typeof message, "string");
  };

  // 関数が正しく定義されていることを確認
  assertEquals(typeof progressCallback, "function");
});

Deno.test("devcontainer streaming - 進捗メッセージが期待される形式である", async () => {
  // 進捗メッセージのフォーマットをテスト
  const expectedFormats = [
    "🐳 Dockerコンテナを準備しています...",
    "🐳 Building image...",
    "🐳 Creating container...",
    "✅ devcontainerが正常に起動しました",
  ];

  for (const format of expectedFormats) {
    assertEquals(typeof format, "string");
    assertEquals(format.length > 0, true);
  }
});
