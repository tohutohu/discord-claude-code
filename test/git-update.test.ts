import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { performGitUpdate } from "../src/git-update.ts";

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
