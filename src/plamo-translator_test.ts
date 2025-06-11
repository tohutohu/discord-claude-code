import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PLaMoTranslator } from "./plamo-translator.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";

// モックサーバーを作成
class MockTranslationServer {
  private server: Deno.HttpServer | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  async start() {
    this.server = Deno.serve({ port: this.port }, (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/health" && req.method === "GET") {
        return new Response("OK", { status: 200 });
      }

      if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
        return req.json().then((body) => {
          const userMessage = body.messages.find((m: { role: string }) =>
            m.role === "user"
          );

          // 簡単な翻訳ルールでモック
          const content = userMessage.content;
          let translated = content;

          // テスト用の特殊なケース
          if (content === "INVALID_JSON_RESPONSE") {
            return new Response(
              "Invalid JSON",
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          } else if (content === "INVALID_RESPONSE_FORMAT") {
            return new Response(
              JSON.stringify({ invalid: "format" }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          } else if (content === "EMPTY_CHOICES") {
            return new Response(
              JSON.stringify({ choices: [] }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          // より現実的な翻訳ロジック
          if (content === "認証機能を実装してください") {
            translated = "Implement authentication functionality";
          } else if (content.includes("エラーハンドリング")) {
            translated = "Add error handling and ensure proper logging output";
          } else {
            translated = "Translated: " + content;
          }

          return new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: translated ||
                    "Implement authentication functionality",
                },
              }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        });
      }

      return new Response("Not Found", { status: 404 });
    });

    // サーバーが起動するまで少し待つ
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  async stop() {
    if (this.server) {
      await this.server.shutdown();
    }
  }
}

Deno.test("PLaMoTranslator - 基本的な翻訳機能", async () => {
  const mockServer = new MockTranslationServer(8765);
  await mockServer.start();

  try {
    const translator = new PLaMoTranslator("http://localhost:8765");

    const result = await translator.translate("認証機能を実装してください");
    assertEquals(result, "Implement authentication functionality");
  } finally {
    await mockServer.stop();
  }
});

Deno.test("PLaMoTranslator - APIサーバーの可用性チェック", async () => {
  const mockServer = new MockTranslationServer(8766);
  await mockServer.start();

  try {
    const translator = new PLaMoTranslator("http://localhost:8766");

    const isAvailable = await translator.isAvailable();
    assert(isAvailable);
  } finally {
    await mockServer.stop();
  }
});

Deno.test("PLaMoTranslator - APIサーバーが利用不可の場合", async () => {
  // 存在しないサーバーを指定
  const translator = new PLaMoTranslator("http://localhost:9999");

  const isAvailable = await translator.isAvailable();
  assertEquals(isAvailable, false);
});

Deno.test("PLaMoTranslator - エラー時は元のテキストを返す", async () => {
  // 存在しないサーバーを指定
  const translator = new PLaMoTranslator("http://localhost:9999");

  const result = await translator.translate("これはテストです");
  assertEquals(result, "これはテストです");
});

Deno.test("PLaMoTranslator - 末尾スラッシュの正規化", () => {
  const translator1 = new PLaMoTranslator("http://localhost:8080/");
  const translator2 = new PLaMoTranslator("http://localhost:8080");

  // 内部的に同じURLになることを確認
  assertEquals(
    translator1["baseUrl"],
    translator2["baseUrl"],
  );
});

Deno.test("PLaMoTranslator - 不正なJSONレスポンスの処理", async () => {
  const mockServer = new MockTranslationServer(8767);
  await mockServer.start();

  try {
    const translator = new PLaMoTranslator("http://localhost:8767");

    // 不正なJSONが返される場合、元のテキストを返す
    const result = await translator.translate("INVALID_JSON_RESPONSE");
    assertEquals(result, "INVALID_JSON_RESPONSE");
  } finally {
    await mockServer.stop();
  }
});

Deno.test("PLaMoTranslator - 不正なレスポンス形式の処理", async () => {
  const mockServer = new MockTranslationServer(8768);
  await mockServer.start();

  try {
    const translator = new PLaMoTranslator("http://localhost:8768");

    // 期待されるフォーマットと異なる場合、元のテキストを返す
    const result = await translator.translate("INVALID_RESPONSE_FORMAT");
    assertEquals(result, "INVALID_RESPONSE_FORMAT");
  } finally {
    await mockServer.stop();
  }
});

Deno.test("PLaMoTranslator - 空のchoices配列の処理", async () => {
  const mockServer = new MockTranslationServer(8769);
  await mockServer.start();

  try {
    const translator = new PLaMoTranslator("http://localhost:8769");

    // choicesが空の場合、元のテキストを返す
    const result = await translator.translate("EMPTY_CHOICES");
    assertEquals(result, "EMPTY_CHOICES");
  } finally {
    await mockServer.stop();
  }
});
