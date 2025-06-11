/**
 * PLaMo-2-translate APIクライアント
 * mlx_lm.serverで立てたPLaMo-2-translateと通信して日本語から英語への翻訳を行う
 */

import { PLAMO_TRANSLATOR } from "./constants.ts";

export interface TranslationRequest {
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
}

export interface TranslationResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class PLaMoTranslator {
  private readonly baseUrl: string;
  private readonly systemPrompt: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

    // コーディング指示に特化したシステムプロンプト
    this.systemPrompt =
      `You are a Japanese to English translator specialized in software development instructions. Your task is to translate Japanese instructions into clear, technical English that is suitable for Claude Code (an AI coding assistant).

Rules for translation:
1. Preserve technical terms and programming keywords as-is (e.g., API, function, class names)
2. Keep code snippets, file paths, and URLs unchanged
3. Translate instructions to be direct and action-oriented
4. Use imperative mood for instructions (e.g., "Implement...", "Create...", "Fix...")
5. Maintain clarity and specificity for coding tasks
6. If the original text contains ambiguity, translate it to be more explicit
7. Preserve any formatting or structure in the original text

Examples:
- "認証機能を実装してください" → "Implement authentication functionality"
- "エラーハンドリングを追加して、適切なログを出力するようにしてください" → "Add error handling and ensure proper logging output"
- "src/main.tsファイルのbugを修正してください" → "Fix the bug in src/main.ts file"

Translate only the user's message. Do not add explanations or additional context.`;
  }

  /**
   * 日本語テキストを英語に翻訳
   * @param text 翻訳対象の日本語テキスト
   * @returns 翻訳された英語テキスト
   */
  async translate(text: string): Promise<string> {
    try {
      const request: TranslationRequest = {
        messages: [
          {
            role: "system",
            content: this.systemPrompt,
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: PLAMO_TRANSLATOR.TEMPERATURE, // より決定的な翻訳のため低めに設定
        max_tokens: PLAMO_TRANSLATOR.MAX_TOKENS,
      };

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(
          `Translation API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json() as TranslationResponse;

      if (!data.choices || data.choices.length === 0) {
        throw new Error("No translation result received");
      }

      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error("Translation failed:", error);
      // エラーが発生した場合は元のテキストを返す
      return text;
    }
  }

  /**
   * APIサーバーへの接続を確認
   * @returns 接続可能な場合true
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(PLAMO_TRANSLATOR.TIMEOUT_MS), // 5秒でタイムアウト
      });
      // レスポンスボディを消費してリークを防ぐ
      await response.text();
      return response.ok;
    } catch {
      return false;
    }
  }
}
