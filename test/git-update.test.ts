import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { performGitUpdate } from "../src/git-update.ts";
import { exec } from "../src/utils/exec.ts";

// テスト用のモックGitリポジトリのセットアップ（統合テスト）
Deno.test("performGitUpdate - 実際のGitリポジトリでの動作確認", async () => {
  // 現在のプロジェクトディレクトリで実行（このテスト自体がGitリポジトリ内で実行されることを前提）
  const statusResult = await exec("git status");

  // Gitリポジトリでない場合はスキップ
  if (!statusResult.success) {
    console.log("Git repository not found, skipping test");
    return;
  }

  // 実際のリポジトリで更新をテスト（破壊的な変更は行わない）
  const result = await performGitUpdate();

  // 結果は成功するはず
  assertEquals(result.success, true);

  // メッセージには何らかの状態が含まれているはず
  assertEquals(result.message.length > 0, true);
});
