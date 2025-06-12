import { GoogleGenAI } from "@google/genai";
import { err, ok, Result } from "neverthrow";
import { GEMINI } from "./constants.ts";

// エラー型定義
export type GeminiError =
  | { type: "API_KEY_NOT_SET" }
  | { type: "API_REQUEST_FAILED"; message: string }
  | { type: "INVALID_RESPONSE"; message: string }
  | { type: "NETWORK_ERROR"; message: string }
  | { type: "RATE_LIMIT"; message: string };

export async function summarizeWithGemini(
  apiKey: string,
  text: string,
  maxLength: number = 30,
): Promise<Result<string, GeminiError>> {
  // APIキーチェック
  if (!apiKey) {
    return err({ type: "API_KEY_NOT_SET" });
  }

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
      model: GEMINI.MODEL_NAME,
      contents: prompt,
      config: {
        temperature: GEMINI.TEMPERATURE,
        topK: 1,
        topP: 0.8,
        maxOutputTokens: GEMINI.MAX_OUTPUT_TOKENS,
      },
    });

    if (!response || !response.text) {
      return err({
        type: "INVALID_RESPONSE",
        message: "No summary generated: API response did not contain text",
      });
    }

    const summary = response.text.trim();

    if (!summary) {
      return err({
        type: "INVALID_RESPONSE",
        message: "Generated summary is empty",
      });
    }

    // 長すぎる場合は切り詰める
    const finalSummary = summary.length > maxLength
      ? summary.substring(0, maxLength - 3) + "..."
      : summary;

    return ok(finalSummary);
  } catch (error) {
    console.error("Gemini summarization error:", error);
    const errorMessage = (error as Error).message;

    // エラータイプの判定
    if (errorMessage.includes("rate limit") || errorMessage.includes("quota")) {
      return err({ type: "RATE_LIMIT", message: errorMessage });
    } else if (
      errorMessage.includes("network") || errorMessage.includes("fetch")
    ) {
      return err({ type: "NETWORK_ERROR", message: errorMessage });
    } else {
      return err({ type: "API_REQUEST_FAILED", message: errorMessage });
    }
  }
}

export function generateThreadName(
  summary: string,
  repositoryName?: string,
): Result<string, GeminiError> {
  // リポジトリ名が提供されていない場合は要約のみを返す
  if (!repositoryName) {
    return ok(summary);
  }

  // リポジトリ名から所有者部分を除去（owner/repo -> repo）
  const repoShortName = repositoryName.includes("/")
    ? repositoryName.split("/")[1]
    : repositoryName;

  return ok(`${summary}(${repoShortName})`);
}
