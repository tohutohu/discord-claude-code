import { exec } from "./utils/exec.ts";

/**
 * Gitリポジトリの更新結果を表すインターフェース
 *
 * @interface UpdateResult
 * @property {boolean} success - 更新操作が成功したかどうか
 * @property {string} message - 操作の詳細なメッセージ（成功・失敗の理由、実行された操作の説明など）
 * @property {boolean} [hasChanges] - リモートから新しい変更を取得したかどうか（変更がない場合はfalse）
 * @property {string[]} [conflicts] - マージ時にコンフリクトが発生したファイルのリスト
 * @property {boolean} [stashed] - ローカル変更をstashに一時保存したかどうか
 */
export interface UpdateResult {
  success: boolean;
  message: string;
  hasChanges?: boolean;
  conflicts?: string[];
  stashed?: boolean;
}

/**
 * Gitリポジトリの安全な更新を実行する
 *
 * この関数は現在のGitリポジトリを安全に更新するための包括的な処理を提供します。
 * ローカルの変更を自動的にstashに保存し、リモートの最新変更を取得してマージを試みます。
 * コンフリクトが発生した場合は、マージを中止して元の状態に戻します。
 *
 * 処理の流れ:
 * 1. ローカルの未コミット変更をチェックし、必要に応じてstashに保存
 * 2. 現在のブランチ名を取得
 * 3. リモートリポジトリから最新情報をfetch
 * 4. 新しいコミットがあるかチェック
 * 5. 新しいコミットがある場合はマージを試行
 * 6. コンフリクトが発生した場合はマージを中止
 * 7. stashに保存した変更を復元（可能な場合）
 *
 * @param {Object} options - オプション設定
 * @param {boolean} [options.skipActualUpdate=false] - 実際のGit操作をスキップするかどうか（テスト用）
 * @returns {Promise<UpdateResult>} 更新結果を含むオブジェクト
 * @throws {Error} 予期しないエラーが発生した場合（catchされてresultに含まれる）
 *
 * @example
 * // 通常の使用例
 * const result = await performGitUpdate();
 * if (result.success) {
 *   console.log("更新成功:", result.message);
 *   if (result.hasChanges) {
 *     console.log("新しい変更を取得しました");
 *   }
 * } else {
 *   console.error("更新失敗:", result.message);
 *   if (result.conflicts) {
 *     console.error("コンフリクトファイル:", result.conflicts);
 *   }
 * }
 *
 * @example
 * // テスト用（実際のGit操作をスキップ）
 * const result = await performGitUpdate({ skipActualUpdate: true });
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
 * 現在のコミットハッシュを取得する
 *
 * 現在チェックアウトされているコミットの完全なSHA-1ハッシュ値を取得します。
 * この関数は`git rev-parse HEAD`コマンドを実行し、現在のHEADが指すコミットのハッシュを返します。
 *
 * @returns {Promise<string>} 現在のコミットの40文字のSHA-1ハッシュ値。取得に失敗した場合は空文字列
 *
 * @example
 * // 現在のコミットハッシュを取得
 * const hash = await getCurrentCommitHash();
 * console.log(`現在のコミット: ${hash}`);
 * // 出力例: 現在のコミット: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
 *
 * @example
 * // エラーハンドリングの例
 * const hash = await getCurrentCommitHash();
 * if (hash === "") {
 *   console.error("コミットハッシュの取得に失敗しました");
 * }
 */
export async function getCurrentCommitHash(): Promise<string> {
  const result = await exec("git rev-parse HEAD");
  return result.success ? result.output.trim() : "";
}

/**
 * 指定されたコミット間の変更ファイルを取得する
 *
 * 2つのコミット間で変更されたファイルのリストを取得します。
 * `git diff --name-only`コマンドを使用して、変更、追加、削除されたファイルのパスを取得します。
 *
 * @param {string} fromCommit - 比較の開始点となるコミット（コミットハッシュ、ブランチ名、タグなど）
 * @param {string} [toCommit="HEAD"] - 比較の終了点となるコミット（デフォルトは現在のHEAD）
 * @returns {Promise<string[]>} 変更されたファイルのパスの配列。取得に失敗した場合は空配列
 *
 * @example
 * // 特定のコミットから現在のHEADまでの変更ファイルを取得
 * const files = await getChangedFiles("abc123def");
 * console.log("変更されたファイル:", files);
 * // 出力例: 変更されたファイル: ["src/main.ts", "README.md", "package.json"]
 *
 * @example
 * // 2つのコミット間の変更ファイルを取得
 * const files = await getChangedFiles("develop", "main");
 * files.forEach(file => {
 *   console.log(`変更: ${file}`);
 * });
 *
 * @example
 * // タグ間の変更を確認
 * const files = await getChangedFiles("v1.0.0", "v2.0.0");
 * console.log(`v1.0.0からv2.0.0までに${files.length}個のファイルが変更されました`);
 */
export async function getChangedFiles(
  fromCommit: string,
  toCommit: string = "HEAD",
): Promise<string[]> {
  const result = await exec(`git diff --name-only ${fromCommit}..${toCommit}`);
  return result.success ? result.output.trim().split("\n").filter(Boolean) : [];
}
