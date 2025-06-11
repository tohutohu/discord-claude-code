import { GoogleGenAI } from "@google/genai";
import { GEMINI } from "./constants.ts";

export interface SummarizeResult {
  success: boolean;
  summary?: string;
  error?: string;
}

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
