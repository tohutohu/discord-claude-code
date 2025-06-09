import { GoogleGenAI } from "@google/genai";

/**
 * Gemini APIによるテキスト要約の結果を表すインターフェース
 *
 * @property {boolean} success - 要約処理が成功したかどうかを示すフラグ
 * @property {string} [summary] - 生成された要約テキスト（成功時のみ設定）
 * @property {string} [error] - エラーメッセージ（失敗時のみ設定）
 */
export interface SummarizeResult {
  success: boolean;
  summary?: string;
  error?: string;
}

/**
 * Google Gemini APIを使用してテキストを要約する
 *
 * この関数は、プログラミングに関する指示やタスクの説明文を、
 * Discordのスレッド名として適切な短い要約に変換します。
 *
 * @param {string} apiKey - Google Gemini APIの認証キー
 * @param {string} text - 要約対象のテキスト（通常はユーザーからの指示文）
 * @param {number} [maxLength=30] - 生成される要約の最大文字数（デフォルト: 30文字）
 * @returns {Promise<SummarizeResult>} 要約結果を含むオブジェクト
 *
 * @example
 * const result = await summarizeWithGemini(
 *   "your-api-key",
 *   "READMEファイルのTypoを修正して、新しいセクションを追加してください",
 *   30
 * );
 * if (result.success) {
 *   console.log(result.summary); // "README更新とTypo修正"
 * }
 *
 * @throws {Error} ネットワークエラーやAPI呼び出しの失敗時にエラーをキャッチして、
 *                 エラー情報を含むSummarizeResultオブジェクトを返します
 */
export async function summarizeWithGemini(
  apiKey: string,
  text: string,
  maxLength: number = 30,
): Promise<SummarizeResult> {
  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt =
      `以下のテキストは、プログラミングに関する指示やタスクの説明です。
このテキストを、Discordのスレッド名として使用するために、以下の条件で要約してください：

1. 最大${maxLength}文字以内
2. 具体的で分かりやすい日本語
3. 主要なタスクや目的を含める
4. 技術的な用語は適切に含める
5. 記号や特殊文字は使わない
6. 敬語は使わない

要約のみを出力してください。説明や前置きは不要です。

テキスト：
${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-05-20",
      contents: prompt,
      config: {
        temperature: 0.3,
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 10000,
      },
    });

    if (!response || !response.text) {
      return {
        success: false,
        error: `No summary generated: ${JSON.stringify(response)}`,
      };
    }

    const summary = response.text.trim();

    if (!summary) {
      return {
        success: false,
        error: "Generated summary is empty",
      };
    }

    // 長すぎる場合は切り詰める
    const finalSummary = summary.length > maxLength
      ? summary.substring(0, maxLength - 3) + "..."
      : summary;

    return {
      success: true,
      summary: finalSummary,
    };
  } catch (error) {
    console.error("Gemini summarization error:", error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * 要約テキストとリポジトリ名からDiscordスレッド名を生成する
 *
 * この関数は、Gemini APIで生成された要約テキストに、
 * オプションでリポジトリ名を付加してDiscordスレッド名を作成します。
 * リポジトリ名が提供された場合は、`要約(リポジトリ名)`の形式になります。
 *
 * @param {string} summary - Gemini APIで生成された要約テキスト
 * @param {string} [repositoryName] - GitHubリポジトリ名（オプション、"owner/repo"形式も可）
 * @returns {string} Discordスレッド名として使用する文字列
 *
 * @example
 * // リポジトリ名なしの場合
 * generateThreadName("README更新とTypo修正");
 * // => "README更新とTypo修正"
 *
 * @example
 * // リポジトリ名ありの場合（owner/repo形式）
 * generateThreadName("README更新とTypo修正", "microsoft/vscode");
 * // => "README更新とTypo修正(vscode)"
 *
 * @example
 * // リポジトリ名ありの場合（repoのみ）
 * generateThreadName("バグ修正", "my-project");
 * // => "バグ修正(my-project)"
 */
export function generateThreadName(
  summary: string,
  repositoryName?: string,
): string {
  // リポジトリ名が提供されていない場合は要約のみを返す
  if (!repositoryName) {
    return summary;
  }

  // リポジトリ名から所有者部分を除去（owner/repo -> repo）
  const repoShortName = repositoryName.includes("/")
    ? repositoryName.split("/")[1]
    : repositoryName;

  return `${summary}(${repoShortName})`;
}
