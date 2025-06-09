import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Worker } from "./worker.ts";
import { WorkspaceManager } from "./workspace.ts";
import { parseRepository } from "./git-utils.ts";
import { ClaudeCommandExecutor } from "./worker.ts";

// モックのClaudeCommandExecutor
class MockClaudeCommandExecutor implements ClaudeCommandExecutor {
  private responses: string[] = [];
  private callCount = 0;
  public lastPrompt: string | null = null;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async executeStreaming(
    args: string[],
    _cwd: string,
    onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    const promptIndex = args.indexOf("-p");
    if (promptIndex !== -1 && promptIndex + 1 < args.length) {
      this.lastPrompt = args[promptIndex + 1];
    }

    // 各レスポンスを順番に送信（ストリーミングをシミュレート）
    while (this.callCount < this.responses.length) {
      const response = this.responses[this.callCount++];
      if (response) {
        const data = new TextEncoder().encode(response + "\n");
        onData(data);
        // 少し待機してストリーミングをシミュレート
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    return { code: 0, stderr: new Uint8Array() };
  }
}

// モックの翻訳サーバー
class MockTranslationServer {
  private server: Deno.HttpServer | null = null;
  private port: number;
  private translations: Map<string, string> = new Map();

  constructor(port: number) {
    this.port = port;
    // デフォルトの翻訳ルール
    this.translations.set(
      "認証機能を実装してください",
      "Implement authentication functionality",
    );
    this.translations.set(
      "エラーハンドリングを追加してください",
      "Add error handling",
    );
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
          const content = userMessage?.content || "";

          // 登録された翻訳があればそれを返す
          const translated = this.translations.get(content) ||
            `Translated: ${content}`;

          return new Response(
            JSON.stringify({
              choices: [{
                message: {
                  content: translated,
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

  addTranslation(japanese: string, english: string) {
    this.translations.set(japanese, english);
  }
}

Deno.test("Worker - 翻訳機能が有効な場合、メッセージが翻訳される", async () => {
  const tempDir = await Deno.makeTempDir();
  const mockServer = new MockTranslationServer(8767);
  await mockServer.start();

  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const mockExecutor = new MockClaudeCommandExecutor([
      JSON.stringify({ type: "session", session_id: "test-session" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "Authentication has been implemented.",
          }],
        },
      }),
      JSON.stringify({
        type: "result",
        result: "Authentication has been implemented.",
        subtype: "test",
        is_error: false,
      }),
    ]);

    const worker = new Worker(
      "test-worker",
      workspaceManager,
      mockExecutor,
      false,
      undefined,
      "http://localhost:8767", // 翻訳URLを設定
    );

    worker.setThreadId("test-thread");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false);

    // リポジトリを設定
    const repository = parseRepository("test/repo");
    if (repository) {
      await worker.setRepository(repository, tempDir);
    }

    const result = await worker.processMessage("認証機能を実装してください");

    // Claudeに渡されたプロンプトが翻訳されているか確認
    assertEquals(
      mockExecutor.lastPrompt,
      "Implement authentication functionality",
    );
    assertEquals(result, "Authentication has been implemented.");
  } finally {
    await mockServer.stop();
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker - 翻訳機能が無効な場合、元のメッセージがそのまま使用される", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const mockExecutor = new MockClaudeCommandExecutor([
      JSON.stringify({ type: "session", session_id: "test-session" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "認証機能を実装しました。" }],
        },
      }),
      JSON.stringify({
        type: "result",
        result: "認証機能を実装しました。",
        subtype: "test",
        is_error: false,
      }),
    ]);

    const worker = new Worker(
      "test-worker",
      workspaceManager,
      mockExecutor,
      false,
      undefined,
      undefined, // 翻訳URLなし
    );

    worker.setThreadId("test-thread");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false);

    // リポジトリを設定
    const repository = parseRepository("test/repo");
    if (repository) {
      await worker.setRepository(repository, tempDir);
    }

    const result = await worker.processMessage("認証機能を実装してください");

    // Claudeに渡されたプロンプトが翻訳されていないことを確認
    assertEquals(mockExecutor.lastPrompt, "認証機能を実装してください");
    assertEquals(result, "認証機能を実装しました。");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker - 翻訳APIがエラーの場合、元のメッセージが使用される", async () => {
  const tempDir = await Deno.makeTempDir();

  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const mockExecutor = new MockClaudeCommandExecutor([
      JSON.stringify({ type: "session", session_id: "test-session" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "エラーハンドリングを追加しました。",
          }],
        },
      }),
      JSON.stringify({
        type: "result",
        result: "エラーハンドリングを追加しました。",
        subtype: "test",
        is_error: false,
      }),
    ]);

    const worker = new Worker(
      "test-worker",
      workspaceManager,
      mockExecutor,
      false,
      undefined,
      "http://localhost:9999", // 存在しないサーバー
    );

    worker.setThreadId("test-thread");

    // devcontainer設定を完了させる
    worker.setUseDevcontainer(false);

    // リポジトリを設定
    const repository = parseRepository("test/repo");
    if (repository) {
      await worker.setRepository(repository, tempDir);
    }

    const result = await worker.processMessage(
      "エラーハンドリングを追加してください",
    );

    // 翻訳が失敗し、元のメッセージが使用されることを確認
    assertEquals(
      mockExecutor.lastPrompt,
      "エラーハンドリングを追加してください",
    );
    assertEquals(result, "エラーハンドリングを追加しました。");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker - VERBOSEモードで翻訳結果がログに出力される", async () => {
  const tempDir = await Deno.makeTempDir();
  const mockServer = new MockTranslationServer(8768);
  await mockServer.start();

  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    await workspaceManager.initialize();

    const mockExecutor = new MockClaudeCommandExecutor([
      JSON.stringify({ type: "session", session_id: "test-session" }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Done!" }],
        },
      }),
      JSON.stringify({
        type: "result",
        result: "Done!",
        subtype: "test",
        is_error: false,
      }),
    ]);

    // consoleログをキャプチャ
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message: string, ...args: unknown[]) => {
      logs.push(message);
      if (args.length > 0) {
        logs.push(...args.map((arg) => String(arg)));
      }
    };

    try {
      const worker = new Worker(
        "test-worker",
        workspaceManager,
        mockExecutor,
        true, // VERBOSEモードを有効化
        undefined,
        "http://localhost:8768",
      );

      worker.setThreadId("test-thread");

      // devcontainer設定を完了させる
      worker.setUseDevcontainer(false);

      // リポジトリを設定
      const repository = parseRepository("test/repo");
      if (repository) {
        await worker.setRepository(repository, tempDir);
      }

      await worker.processMessage("エラーハンドリングを追加してください");

      // 翻訳結果がログに記録されているか確認
      const hasTranslationLog = logs.some((log) =>
        log.includes("翻訳結果:") ||
        log.includes("元のメッセージ:") ||
        log.includes("翻訳後:")
      );

      // デバッグ用：ログの内容を確認
      if (!hasTranslationLog) {
        console.error("Captured logs:", logs);
      }

      assertEquals(hasTranslationLog, true);
    } finally {
      console.log = originalLog;
    }
  } finally {
    await mockServer.stop();
    await Deno.remove(tempDir, { recursive: true });
  }
});
