import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  getChangedFilesResult,
  getCurrentCommitHashResult,
  performGitUpdate,
  updateWorktreeToLatest,
} from "../src/git-update.ts";

// performGitUpdateがテストモードで動作することを確認
Deno.test("performGitUpdate - テストモードでの動作確認", async () => {
  // skipActualUpdateオプションを使用してテスト
  const result = await performGitUpdate({ skipActualUpdate: true });

  // 結果は成功するはず
  assertEquals(result.success, true);

  // テストモードのメッセージが含まれているはず
  assertEquals(
    result.message,
    "テスト実行中のため、実際のgit更新はスキップされました",
  );
});

// Result型対応のテスト
Deno.test("updateWorktreeToLatest - 存在しないディレクトリ", async () => {
  const result = await updateWorktreeToLatest("/non/existent/path");

  assertEquals(result.isErr(), true);
  if (result.isErr()) {
    assertEquals(result.error.type, "REPOSITORY_NOT_FOUND");
    if (result.error.type === "REPOSITORY_NOT_FOUND") {
      assertEquals(result.error.path, "/non/existent/path");
    }
  }
});

Deno.test("getCurrentCommitHashResult - Gitリポジトリ以外での実行", async () => {
  // 一時ディレクトリを作成
  const tempDir = await Deno.makeTempDir();
  const originalCwd = Deno.cwd();

  try {
    Deno.chdir(tempDir);
    const result = await getCurrentCommitHashResult();

    assertEquals(result.isErr(), true);
    if (result.isErr()) {
      assertEquals(result.error.type, "GIT_COMMAND_FAILED");
      if (result.error.type === "GIT_COMMAND_FAILED") {
        assertEquals(result.error.command, "git rev-parse HEAD");
      }
    }
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("getChangedFilesResult - 無効なコミット範囲", async () => {
  const result = await getChangedFilesResult(
    "invalid-commit-1",
    "invalid-commit-2",
  );

  // Gitリポジトリ内で実行されていない場合はエラー
  if (result.isErr()) {
    assertEquals(result.error.type, "GIT_COMMAND_FAILED");
    if (result.error.type === "GIT_COMMAND_FAILED") {
      assertExists(result.error.command);
    }
  } // Gitリポジトリ内の場合は空の配列が返る可能性もある
  else {
    assertEquals(Array.isArray(result.value), true);
  }
});
