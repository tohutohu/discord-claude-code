/**
 * アプリケーション全体で使用する定数を定義
 */

// レート制限関連の定数
export const RATE_LIMIT = {
  AUTO_RESUME_DELAY_MS: 300_000, // 5分
} as const;

// Discord関連の定数
export const DISCORD = {
  MAX_MESSAGE_LENGTH: 2000,
  TRUNCATE_LENGTH: 1900,
} as const;

// メッセージフォーマット関連の定数
export const FORMATTING = {
  SHORT_RESULT_THRESHOLD: 500,
  LONG_RESULT_THRESHOLD: 2000,
} as const;

// DevContainer関連の定数
export const DEVCONTAINER = {
  MAX_LOG_LINES: 30,
  PROGRESS_UPDATE_INTERVAL_MS: 2000,
  PROGRESS_NOTIFY_INTERVAL_MS: 1000,
} as const;

// Git関連の定数
export const GIT = {
  DEFAULT_BRANCH: "main",
  BOT_USER_NAME: "Discord Bot",
  BOT_USER_EMAIL: "bot@example.com",
} as const;

// Gemini API関連の定数
export const GEMINI = {
  MODEL_NAME: "gemini-2.5-flash-preview-05-20",
  MAX_OUTPUT_TOKENS: 10000,
  TEMPERATURE: 0.3,
} as const;

// PLaMo Translator関連の定数
export const PLAMO_TRANSLATOR = {
  TEMPERATURE: 0.1,
  MAX_TOKENS: 2048,
  TIMEOUT_MS: 5000,
} as const;
