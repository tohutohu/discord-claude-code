/**
 * Discord Botの環境変数設定を管理するインターフェース
 *
 * アプリケーション全体で使用される環境変数の型定義を提供します。
 * 必須の設定項目とオプションの設定項目を明確に区別しています。
 */
export interface Env {
  /**
   * Discord Botのアクセストークン（必須）
   *
   * Discord Developer Portalから取得したBotトークンを指定します。
   * このトークンはBotがDiscord APIと通信するために必要です。
   */
  DISCORD_TOKEN: string;

  /**
   * 作業ディレクトリのベースパス（必須）
   *
   * Botが使用する作業ディレクトリのルートパスを指定します。
   * このディレクトリ配下に以下のサブディレクトリが作成されます：
   * - repositories/: クローンされたGitHubリポジトリ
   * - threads/: スレッド情報の永続化データ
   * - sessions/: Claudeセッションログ
   * - audit/: 監査ログ
   *
   * 旧CLONE_BASE_DIRから名称変更されました。
   */
  WORK_BASE_DIR: string;

  /**
   * 詳細ログ出力フラグ（オプション）
   *
   * trueに設定すると、デバッグ用の詳細なログが出力されます。
   * 開発時のトラブルシューティングに使用します。
   */
  VERBOSE?: boolean;

  /**
   * Claude実行時に追加するシステムプロンプト（オプション）
   *
   * Claude CLIの`--append-system-prompt`オプションに渡される追加の指示です。
   * 既存のシステムプロンプトに追加のコンテキストや制約を与えたい場合に使用します。
   * 例: 特定のコーディング規約の遵守、セキュリティ要件の追加など
   */
  CLAUDE_APPEND_SYSTEM_PROMPT?: string;

  /**
   * Google Gemini APIキー（オプション）
   *
   * 設定されている場合、以下の機能が有効になります：
   * - 最初のユーザーメッセージを要約してスレッド名を自動生成
   * - スレッド名のフォーマット: `${指示の要約}(${リポジトリ名})`
   * - Discordのスレッド一覧で見やすくなるよう最大30文字に制限
   *
   * Google AI Studioから取得したAPIキーを指定します。
   */
  GEMINI_API_KEY?: string;
  /**
   * PLaMo-2-translate API URL（オプション）
   * 設定されている場合、日本語の指示を英語に翻訳してからClaude Codeに渡す
   * 例: http://localhost:8080
   */
  PLAMO_TRANSLATOR_URL?: string;
}

/**
 * 環境変数から設定を読み込み、Envオブジェクトを生成します
 *
 * この関数は、アプリケーションの起動時に環境変数を読み込み、
 * 必須項目の検証を行った上で、型安全なEnvオブジェクトを返します。
 *
 * @returns {Env} 環境変数設定を含むEnvオブジェクト
 *
 * @throws {Error} DISCORD_TOKENが設定されていない場合
 * @throws {Error} WORK_BASE_DIRが設定されていない場合
 *
 * @example
 * ```typescript
 * // アプリケーション起動時の使用例
 * const env = getEnv();
 * const bot = new DiscordBot(env.DISCORD_TOKEN);
 * const workspaceManager = new WorkspaceManager(env.WORK_BASE_DIR);
 * ```
 *
 * @remarks
 * - VERBOSEは文字列"true"の場合のみtrueとして解釈されます
 * - オプション項目（CLAUDE_APPEND_SYSTEM_PROMPT、GEMINI_API_KEY）は
 *   未設定の場合undefinedとして返されます
 * - 環境変数の読み込みにはDeno.env.get()を使用するため、
 *   実行時に`--allow-env`権限が必要です
 */
export function getEnv(): Env {
  const token = Deno.env.get("DISCORD_TOKEN");
  const workBaseDir = Deno.env.get("WORK_BASE_DIR");
  const verbose = Deno.env.get("VERBOSE") === "true";
  const claudeAppendSystemPrompt = Deno.env.get("CLAUDE_APPEND_SYSTEM_PROMPT");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const plamoTranslatorUrl = Deno.env.get("PLAMO_TRANSLATOR_URL");

  if (!token) {
    throw new Error("DISCORD_TOKEN is not set");
  }

  if (!workBaseDir) {
    throw new Error("WORK_BASE_DIR is not set");
  }

  return {
    DISCORD_TOKEN: token,
    WORK_BASE_DIR: workBaseDir,
    VERBOSE: verbose,
    CLAUDE_APPEND_SYSTEM_PROMPT: claudeAppendSystemPrompt,
    GEMINI_API_KEY: geminiApiKey,
    PLAMO_TRANSLATOR_URL: plamoTranslatorUrl,
  };
}
