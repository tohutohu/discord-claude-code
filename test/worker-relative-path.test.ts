import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { Worker } from "../src/worker.ts";
import { WorkspaceManager } from "../src/workspace.ts";
import { createTestWorkerState } from "./test-utils.ts";

class TestWorker extends Worker {
  // テスト用にgetRelativePathをpublicにする
  public testGetRelativePath(filePath: string): string {
    // @ts-ignore - private メソッドにアクセス
    return this.getRelativePath(filePath);
  }

  // テスト用にworktreePathを設定できるようにする
  public setWorktreePathForTest(path: string | null): void {
    // @ts-ignore - private プロパティにアクセス
    this.state.worktreePath = path;
  }
}

Deno.test("Worker.getRelativePath - worktreePathが設定されている場合", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new TestWorker(state, workspaceManager);

    // worktreePathを設定
    const worktreePath = "/Users/test/workspace/repositories/org/repo";
    worker.setWorktreePathForTest(worktreePath);

    // worktreePath内のファイル
    assertEquals(
      worker.testGetRelativePath(`${worktreePath}/src/main.ts`),
      "src/main.ts",
    );

    // worktreePath外のファイル
    assertEquals(
      worker.testGetRelativePath("/some/other/path/file.ts"),
      "/some/other/path/file.ts",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker.getRelativePath - リポジトリパターンの場合", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new TestWorker(state, workspaceManager);

    // worktreePathが未設定
    worker.setWorktreePathForTest(null);

    // repositories ディレクトリ内のファイル
    assertEquals(
      worker.testGetRelativePath(
        "/work/repositories/myorg/myrepo/src/index.ts",
      ),
      "src/index.ts",
    );

    // 別のリポジトリ
    assertEquals(
      worker.testGetRelativePath("/var/data/repositories/org2/repo2/README.md"),
      "README.md",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker.getRelativePath - threadsパターンの場合", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new TestWorker(state, workspaceManager);

    // worktreePathが未設定
    worker.setWorktreePathForTest(null);

    // threads ディレクトリ内のworktree
    assertEquals(
      worker.testGetRelativePath("/work/threads/thread123/worktree/src/app.ts"),
      "src/app.ts",
    );

    // 別のスレッド
    assertEquals(
      worker.testGetRelativePath(
        "/data/threads/thread456/worktree/package.json",
      ),
      "package.json",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker.getRelativePath - 特殊なケース", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new TestWorker(state, workspaceManager);

    // 空文字列
    assertEquals(worker.testGetRelativePath(""), "");

    // パターンにマッチしない通常のパス
    assertEquals(
      worker.testGetRelativePath("/usr/local/bin/some-file"),
      "/usr/local/bin/some-file",
    );

    // worktreePathがルートディレクトリ終端のスラッシュあり
    worker.setWorktreePathForTest("/work/repo/");
    assertEquals(
      worker.testGetRelativePath("/work/repo/file.ts"),
      "file.ts",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("Worker.getRelativePath - Discord表示時の実際の使用", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const workspaceManager = new WorkspaceManager(tempDir);
    const state = createTestWorkerState("test-worker", "test-thread-1");
    const worker = new TestWorker(state, workspaceManager);

    // 実際のワークツリーパス例
    const worktreePath =
      "/Users/to-hutohu/workspace/claude-code-repos/worktrees/1234567890";
    worker.setWorktreePathForTest(worktreePath);

    // Read ツールの場合
    const filePath = `${worktreePath}/src/main.ts`;
    assertEquals(worker.testGetRelativePath(filePath), "src/main.ts");

    // ネストしたディレクトリ
    const nestedPath = `${worktreePath}/src/components/Button/index.tsx`;
    assertEquals(
      worker.testGetRelativePath(nestedPath),
      "src/components/Button/index.tsx",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
