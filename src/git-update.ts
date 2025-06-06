import { exec } from "./utils/exec.ts";

export interface UpdateResult {
  success: boolean;
  message: string;
  hasChanges?: boolean;
  conflicts?: string[];
  stashed?: boolean;
}

/**
 * Gitリポジトリの安全な更新を実行する
 */
export async function performGitUpdate(): Promise<UpdateResult> {
  const result: UpdateResult = {
    success: false,
    message: "",
  };

  try {
    // 1. 現在の状態を確認
    const statusResult = await exec("git status --porcelain");
    const hasLocalChanges = statusResult.output.trim().length > 0;

    if (hasLocalChanges) {
      result.stashed = true;
      // ローカル変更をstashに保存
      const stashResult = await exec(
        `git stash push -m "Auto-stash before update at ${
          new Date().toISOString()
        }"`,
      );
      if (!stashResult.success) {
        result.message = "ローカル変更の一時保存に失敗しました。";
        return result;
      }
      result.message += "ローカル変更を一時保存しました。\n";
    }

    // 2. 現在のブランチを取得
    const branchResult = await exec("git branch --show-current");
    const currentBranch = branchResult.output.trim();

    // 3. リモートの最新情報を取得
    const fetchResult = await exec("git fetch origin");
    if (!fetchResult.success) {
      result.message += "リモートリポジトリからの取得に失敗しました。";
      if (result.stashed) {
        await exec("git stash pop");
        result.message += "\nローカル変更を復元しました。";
      }
      return result;
    }

    // 4. 更新の確認（マージ前に確認）
    const logResult = await exec(
      "git log --oneline HEAD..origin/" + currentBranch,
    );
    const hasUpdates = logResult.output.trim().length > 0;

    if (!hasUpdates) {
      result.message += "すでに最新の状態です。\n";
      result.hasChanges = false;
      result.success = true;

      // stashの復元（必要な場合）
      if (result.stashed) {
        const popResult = await exec("git stash pop");
        if (popResult.success) {
          result.message += "ローカル変更を復元しました。\n";
        } else {
          result.message +=
            "ローカル変更の復元に失敗しました。`git stash list`で確認してください。\n";
        }
      }

      return result;
    }

    const updateCount =
      logResult.output.trim().split("\n").filter(Boolean).length;
    result.message += `${updateCount}件の新しいコミットが見つかりました。\n`;

    // 5. マージまたはリベースを試行
    const mergeResult = await exec(`git merge origin/${currentBranch}`);

    if (!mergeResult.success) {
      // コンフリクトの可能性をチェック
      const conflictCheckResult = await exec(
        "git diff --name-only --diff-filter=U",
      );
      const conflictedFiles = conflictCheckResult.output.trim().split("\n")
        .filter(Boolean);

      if (conflictedFiles.length > 0) {
        result.conflicts = conflictedFiles;
        result.message += `コンフリクトが発生しました:\n${
          conflictedFiles.join("\n")
        }\n`;

        // マージを中止
        await exec("git merge --abort");

        if (result.stashed) {
          await exec("git stash pop");
          result.message += "\nローカル変更を復元しました。";
        }

        result.message += "\n手動でコンフリクトを解決してください。";
        return result;
      }
    }

    result.message += "マージが成功しました。\n";
    result.hasChanges = true;

    // 6. stashの復元（必要な場合）
    if (result.stashed) {
      const popResult = await exec("git stash pop");
      if (popResult.success) {
        result.message += "ローカル変更を復元しました。\n";
      } else {
        result.message +=
          "ローカル変更の復元に失敗しました。`git stash list`で確認してください。\n";
      }
    }

    result.success = true;
    return result;
  } catch (error) {
    result.message = `予期しないエラーが発生しました: ${
      (error as Error).message
    }`;
    return result;
  }
}

/**
 * 現在のコミットハッシュを取得
 */
export async function getCurrentCommitHash(): Promise<string> {
  const result = await exec("git rev-parse HEAD");
  return result.success ? result.output.trim() : "";
}

/**
 * 指定されたコミット間の変更ファイルを取得
 */
export async function getChangedFiles(
  fromCommit: string,
  toCommit: string = "HEAD",
): Promise<string[]> {
  const result = await exec(`git diff --name-only ${fromCommit}..${toCommit}`);
  return result.success ? result.output.trim().split("\n").filter(Boolean) : [];
}
