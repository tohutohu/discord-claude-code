import { assertEquals } from "https://deno.land/std@0.208.0/testing/asserts.ts";
import { Worker } from "./worker.ts";
import { WorkerState, WorkspaceManager } from "./workspace.ts";

// テスト用のClaudeCommandExecutor
class TestClaudeCommandExecutor {
  async executeStreaming(
    _args: string[],
    _cwd: string,
    _onData: (data: Uint8Array) => void,
  ): Promise<{ code: number; stderr: Uint8Array }> {
    return { code: 0, stderr: new Uint8Array() };
  }
}

Deno.test("extractOutputMessage - タスクエージェントの配列形式tool_resultを正しく処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const state: WorkerState = {
    workerName: "test-worker",
    threadId: "test-thread-1",
    devcontainerConfig: {
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
    status: "active",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  const worker = new Worker(
    state,
    workspaceManager,
    new TestClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // タスクエージェントからの配列形式のtool_result
    const taskAgentMessage = {
      "type": "user",
      "message": {
        "role": "user",
        "content": [{
          "tool_use_id": "toolu_01XB7b34HoDx51eWw2JffqYB",
          "type": "tool_result",
          "content": [{
            "type": "text",
            "text":
              "現在のブランチ `worker-1380511525390782525-1749209996581` の状態を確認しました。以下が概要です：\n\n## 現在の状態\n- **ブランチ**: worker-1380511525390782525-1749209996581\n- **ワーキングツリー**: クリーン（コミットされていない変更なし）\n- **最新コミット**: `859a791 fix: lint修正 - IWorkerインターフェースにメソッドを追加`\n\n## mainブランチからの変更\nmainブランチから現在のブランチまでに、以下の3つのファイルに変更があります：\n\n1. **src/main.ts** - 15行追加\n2. **src/worker.ts** - 2行追加  \n3. **test/admin.test.ts** - 11行変更（7行削除、4行追加）\n\n## コミット履歴\n最新のコミットは「lint修正 - IWorkerインターフェースにメソッドを追加」で、これはmainブランチの最新コミット（`03d03b5 fix: スレッド終了時の処理順序を修正`）の後に追加されています。\n\nこの変更は、IWorkerインターフェースにメソッドを追加し、それに伴うlintエラーを修正したもののようです。PRを作成する準備ができている状態です。",
          }],
        }],
      },
      "session_id": "49972f78-5370-49f6-8a29-e02064f43ed3",
    };

    const result = extractOutputMessage(taskAgentMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(
      result?.includes(
        "現在のブランチ `worker-1380511525390782525-1749209996581` の状態を確認しました",
      ),
      true,
    );
    assertEquals(result?.includes("## 現在の状態"), true);
    assertEquals(
      result?.includes("PRを作成する準備ができている状態です"),
      true,
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - 複数のテキスト要素を持つ配列形式tool_resultを処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const state: WorkerState = {
    workerName: "test-worker",
    threadId: "test-thread-1",
    devcontainerConfig: {
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
    status: "active",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  const worker = new Worker(
    state,
    workspaceManager,
    new TestClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // 複数のテキスト要素を含む配列
    const multiTextMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": [
            {
              "type": "text",
              "text": "最初のテキスト部分\n",
            },
            {
              "type": "text",
              "text": "2番目のテキスト部分\n",
            },
            {
              "type": "text",
              "text": "3番目のテキスト部分",
            },
          ],
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(multiTextMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("最初のテキスト部分"), true);
    assertEquals(result?.includes("2番目のテキスト部分"), true);
    assertEquals(result?.includes("3番目のテキスト部分"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - エラー時の配列形式tool_resultを処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const state: WorkerState = {
    workerName: "test-worker",
    threadId: "test-thread-1",
    devcontainerConfig: {
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
    status: "active",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  const worker = new Worker(
    state,
    workspaceManager,
    new TestClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // エラー時の配列形式
    const errorArrayMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": [{
            "type": "text",
            "text":
              "Error: タスクの実行に失敗しました\n詳細: ファイルが見つかりません",
          }],
          "is_error": true,
        }],
      },
    };

    const result = extractOutputMessage(errorArrayMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("❌ **ツール実行結果:**"), true);
    assertEquals(result?.includes("Error: タスクの実行に失敗しました"), true);
    assertEquals(result?.includes("詳細: ファイルが見つかりません"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - text以外の要素を含む配列は無視する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const state: WorkerState = {
    workerName: "test-worker",
    threadId: "test-thread-1",
    devcontainerConfig: {
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
    status: "active",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  const worker = new Worker(
    state,
    workspaceManager,
    new TestClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // text以外の要素を含む配列
    const mixedContentMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": [
            {
              "type": "text",
              "text": "有効なテキスト",
            },
            {
              "type": "image",
              "source": "some-image-data",
            },
            {
              "type": "text",
              "text": "別の有効なテキスト",
            },
          ],
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(mixedContentMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("有効なテキスト"), true);
    assertEquals(result?.includes("別の有効なテキスト"), true);
    // image要素は無視される
    assertEquals(result?.includes("some-image-data"), false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("extractOutputMessage - 空の配列形式contentを処理する", async () => {
  const tempDir = await Deno.makeTempDir();
  const workspaceManager = new WorkspaceManager(tempDir);
  await workspaceManager.initialize();

  const state: WorkerState = {
    workerName: "test-worker",
    threadId: "test-thread-1",
    devcontainerConfig: {
      useDevcontainer: false,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    },
    status: "active",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  const worker = new Worker(
    state,
    workspaceManager,
    new TestClaudeCommandExecutor(),
    undefined,
    undefined,
  );

  const extractOutputMessage = (worker as unknown as {
    extractOutputMessage: (parsed: Record<string, unknown>) => string | null;
  }).extractOutputMessage.bind(worker);

  try {
    // 空の配列
    const emptyArrayMessage = {
      "type": "user",
      "message": {
        "content": [{
          "type": "tool_result",
          "content": [],
          "is_error": false,
        }],
      },
    };

    const result = extractOutputMessage(emptyArrayMessage);

    assertEquals(typeof result, "string");
    assertEquals(result?.includes("✅ **ツール実行結果:**"), true);
    assertEquals(result?.includes("(空の結果)"), true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
