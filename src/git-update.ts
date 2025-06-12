import { exec } from "./utils/exec.ts";
import { err, ok, Result } from "neverthrow";

export interface UpdateResult {
  success: boolean;
  message: string;
  hasChanges?: boolean;
  conflicts?: string[];
  stashed?: boolean;
}

export type GitUpdateError =
  | { type: "GIT_COMMAND_FAILED"; command: string; error: string }
  | { type: "REPOSITORY_NOT_FOUND"; path: string }
  | { type: "FETCH_FAILED"; error: string }
  | { type: "BRANCH_SWITCH_FAILED"; branch: string; error: string }
  | { type: "MERGE_FAILED"; error: string }
  | { type: "UNCOMMITTED_CHANGES"; files: string[] }
  | { type: "MERGE_CONFLICT"; conflicts: string[] }
  | { type: "STASH_FAILED"; operation: "push" | "pop"; error: string }
  | { type: "UNEXPECTED_ERROR"; error: string };

/**
 * GitUpdateErrorからエラーメッセージを取得
 */
export function getErrorMessage(error: GitUpdateError): string {
  switch (error.type) {
    case "GIT_COMMAND_FAILED":
      return error.error;
    case "REPOSITORY_NOT_FOUND":
      return `Repository not found: ${error.path}`;
    case "FETCH_FAILED":
      return error.error;
    case "BRANCH_SWITCH_FAILED":
      return error.error;
    case "MERGE_FAILED":
      return error.error;
    case "UNCOMMITTED_CHANGES":
      return `Uncommitted changes in files: ${error.files.join(", ")}`;
    case "MERGE_CONFLICT":
      return `Merge conflicts in files: ${error.conflicts.join(", ")}`;
    case "STASH_FAILED":
      return error.error;
    case "UNEXPECTED_ERROR":
      return error.error;
  }
}

/**
 * Gitコマンドを実行してResult型で結果を返す
 */
async function execGit(
  command: string,
): Promise<Result<string, GitUpdateError>> {
  try {
    const result = await exec(command);
    if (!result.success) {
      return err({
        type: "GIT_COMMAND_FAILED",
        command,
        error: result.error || "Unknown error",
      });
    }
    return ok(result.output.trim());
  } catch (error) {
    return err({
      type: "GIT_COMMAND_FAILED",
      command,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * コミットされていない変更をチェック
 */
async function hasUncommittedChanges(): Promise<
  Result<boolean, GitUpdateError>
> {
  const result = await execGit("git status --porcelain");
  if (result.isErr()) {
    return err(result.error);
  }
  return ok(result.value.length > 0);
}

/**
 * 現在のブランチ名を取得
 */
async function getCurrentBranch(): Promise<Result<string, GitUpdateError>> {
  const result = await execGit("git branch --show-current");
  if (result.isErr()) {
    return err(result.error);
  }
  return ok(result.value);
}

/**
 * マージコンフリクトをチェック
 */
async function checkMergeConflicts(): Promise<
  Result<string[], GitUpdateError>
> {
  const result = await execGit("git diff --name-only --diff-filter=U");
  if (result.isErr()) {
    return err(result.error);
  }
  const conflicts = result.value.split("\n").filter(Boolean);
  return ok(conflicts);
}

/**
 * Gitリポジトリの安全な更新を実行する
 * @param options - オプション設定
 * @param options.skipActualUpdate - 実際のGit操作をスキップするかどうか（テスト用）
 */
export async function performGitUpdate(
  options: { skipActualUpdate?: boolean } = {},
): Promise<UpdateResult> {
  const result: UpdateResult = {
    success: false,
    message: "",
  };

  try {
    // テスト用オプションが指定されている場合は実際のgit操作をスキップ
    if (options.skipActualUpdate) {
      result.success = true;
      result.message = "テスト実行中のため、実際のgit更新はスキップされました";
      return result;
    }

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
 * 現在のコミットハッシュを取得（Result型版）
 */
export async function getCurrentCommitHashResult(): Promise<
  Result<string, GitUpdateError>
> {
  const result = await execGit("git rev-parse HEAD");
  if (result.isErr()) {
    return err(result.error);
  }
  return ok(result.value);
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

/**
 * 指定されたコミット間の変更ファイルを取得（Result型版）
 */
export async function getChangedFilesResult(
  fromCommit: string,
  toCommit: string = "HEAD",
): Promise<Result<string[], GitUpdateError>> {
  const result = await execGit(
    `git diff --name-only ${fromCommit}..${toCommit}`,
  );
  if (result.isErr()) {
    return err(result.error);
  }
  return ok(result.value.split("\n").filter(Boolean));
}

/**
 * Worktreeを最新の状態に更新する（neverthrow対応版）
 */
export async function updateWorktreeToLatest(
  worktreePath: string,
  _targetBranch: string = "main",
): Promise<Result<UpdateResult, GitUpdateError>> {
  const updateResult: UpdateResult = {
    success: false,
    message: "",
  };

  try {
    // 作業ディレクトリを変更
    const originalCwd = Deno.cwd();
    try {
      Deno.chdir(worktreePath);
    } catch (error) {
      return err({
        type: "REPOSITORY_NOT_FOUND",
        path: worktreePath,
      });
    }

    // 1. uncommitted changesをチェック
    const changesResult = await hasUncommittedChanges();
    if (changesResult.isErr()) {
      Deno.chdir(originalCwd);
      return err(changesResult.error);
    }

    if (changesResult.value) {
      // stashに保存
      const stashResult = await execGit(
        `git stash push -m "Auto-stash before update at ${
          new Date().toISOString()
        }"`,
      );
      if (stashResult.isErr()) {
        Deno.chdir(originalCwd);
        return err({
          type: "STASH_FAILED",
          operation: "push",
          error: getErrorMessage(stashResult.error),
        });
      }
      updateResult.stashed = true;
      updateResult.message += "ローカル変更を一時保存しました。\n";
    }

    // 2. 現在のブランチを取得
    const branchResult = await getCurrentBranch();
    if (branchResult.isErr()) {
      Deno.chdir(originalCwd);
      return err(branchResult.error);
    }
    const currentBranch = branchResult.value;

    // 3. fetchを実行
    const fetchResult = await execGit("git fetch origin");
    if (fetchResult.isErr()) {
      if (updateResult.stashed) {
        await execGit("git stash pop");
      }
      Deno.chdir(originalCwd);
      return err({
        type: "FETCH_FAILED",
        error: getErrorMessage(fetchResult.error),
      });
    }

    // 4. 更新をチェック
    const logResult = await execGit(
      `git log --oneline HEAD..origin/${currentBranch}`,
    );
    if (logResult.isErr()) {
      if (updateResult.stashed) {
        await execGit("git stash pop");
      }
      Deno.chdir(originalCwd);
      return err(logResult.error);
    }

    const hasUpdates = logResult.value.length > 0;
    if (!hasUpdates) {
      updateResult.message += "すでに最新の状態です。\n";
      updateResult.hasChanges = false;
      updateResult.success = true;

      // stashの復元
      if (updateResult.stashed) {
        const popResult = await execGit("git stash pop");
        if (popResult.isOk()) {
          updateResult.message += "ローカル変更を復元しました。\n";
        } else {
          updateResult.message +=
            "ローカル変更の復元に失敗しました。`git stash list`で確認してください。\n";
        }
      }

      Deno.chdir(originalCwd);
      return ok(updateResult);
    }

    const updateCount = logResult.value.split("\n").filter(Boolean).length;
    updateResult.message +=
      `${updateCount}件の新しいコミットが見つかりました。\n`;

    // 5. マージを実行
    const mergeResult = await execGit(`git merge origin/${currentBranch}`);
    if (mergeResult.isErr()) {
      // コンフリクトをチェック
      const conflictsResult = await checkMergeConflicts();
      if (conflictsResult.isOk() && conflictsResult.value.length > 0) {
        // マージを中止
        await execGit("git merge --abort");

        if (updateResult.stashed) {
          await execGit("git stash pop");
        }

        Deno.chdir(originalCwd);
        return err({
          type: "MERGE_CONFLICT",
          conflicts: conflictsResult.value,
        });
      }

      if (updateResult.stashed) {
        await execGit("git stash pop");
      }

      Deno.chdir(originalCwd);
      return err({
        type: "MERGE_FAILED",
        error: getErrorMessage(mergeResult.error),
      });
    }

    updateResult.message += "マージが成功しました。\n";
    updateResult.hasChanges = true;

    // 6. stashの復元
    if (updateResult.stashed) {
      const popResult = await execGit("git stash pop");
      if (popResult.isOk()) {
        updateResult.message += "ローカル変更を復元しました。\n";
      } else {
        updateResult.message +=
          "ローカル変更の復元に失敗しました。`git stash list`で確認してください。\n";
      }
    }

    updateResult.success = true;
    Deno.chdir(originalCwd);
    return ok(updateResult);
  } catch (error) {
    return err({
      type: "UNEXPECTED_ERROR",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
