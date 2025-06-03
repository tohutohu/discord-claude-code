// Discord 関連の型定義
// セッション管理、コマンド、インタラクションで使用される型を定義

import type { CreateApplicationCommand, Interaction } from '../deps.ts';

/**
 * セッション状態の列挙型
 */
export enum SessionState {
  INITIALIZING = '初期化中',
  STARTING = '起動中',
  READY = '準備完了',
  RUNNING = '実行中',
  WAITING = '待機中',
  ERROR = 'エラー',
  COMPLETED = '完了',
  CANCELLED = 'キャンセル',
}

/**
 * セッションメタデータ
 */
export interface SessionMetadata {
  /** DiscordユーザーID */
  userId: string;
  /** DiscordギルドID */
  guildId: string;
  /** セッション開始時刻 */
  startedAt: Date;
  /** 最終更新時刻 */
  updatedAt: Date;
}

/**
 * セッション情報
 */
export interface SessionInfo {
  /** Discord スレッドID（セッション識別子） */
  threadId: string;
  /** 対象リポジトリ名 */
  repository: string;
  /** worktree のパス */
  worktreePath: string;
  /** DevContainer ID */
  containerId?: string;
  /** セッション状態 */
  state: SessionState;
  /** セッション作成日時 */
  createdAt: string;
  /** セッション更新日時 */
  updatedAt: string;
  /** メタデータ */
  metadata: SessionMetadata;
}

/**
 * セッション一覧の永続化形式
 */
export interface SessionStorage {
  sessions: Record<string, SessionInfo>;
}

/**
 * キュー位置情報
 */
export interface QueuePosition {
  /** 現在の位置（1から開始） */
  position: number;
  /** 総待機数 */
  total: number;
  /** 推定待機時間（秒） */
  estimatedWaitTime?: number;
}

/**
 * Slash コマンドの基本構造
 */
export interface SlashCommand {
  /** コマンド名 */
  name: string;
  /** コマンド説明 */
  description: string;
  /** コマンドタイプ */
  type?: number;
  /** オプション */
  options?: unknown[];
  /** コマンド実行ハンドラ */
  execute: (interaction: Interaction) => Promise<void>;
  /** オートコンプリート処理（オプション） */
  autocomplete?: (interaction: Interaction) => unknown;
}

/**
 * start コマンドのオプション
 */
export interface StartCommandOptions {
  /** リポジトリ名 */
  repository: string;
  /** ブランチ名（オプション） */
  branch?: string;
}

/**
 * list コマンドのページネーション情報
 */
export interface ListPagination {
  /** 現在のページ（0から開始） */
  page: number;
  /** 1ページあたりの件数 */
  pageSize: number;
  /** 総件数 */
  totalItems: number;
  /** 総ページ数 */
  totalPages: number;
}

/**
 * Embed カラー定義
 */
export enum EmbedColor {
  SUCCESS = 0x00ff00, // 緑
  ERROR = 0xff0000, // 赤
  WARNING = 0xffff00, // 黄色
  INFO = 0x0099ff, // 青
  RUNNING = 0x9966ff, // 紫
}

/**
 * Embed ビルダーのオプション
 */
export interface EmbedOptions {
  /** タイトル */
  title?: string;
  /** 説明 */
  description?: string;
  /** カラー */
  color?: EmbedColor;
  /** フィールド一覧 */
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  /** フッター */
  footer?: {
    text: string;
    iconUrl?: string;
  };
  /** タイムスタンプ */
  timestamp?: Date;
  /** サムネイル */
  thumbnail?: {
    url: string;
  };
}

/**
 * プログレスバーの設定
 */
export interface ProgressBarConfig {
  /** 進捗率（0-100） */
  progress: number;
  /** バーの長さ（文字数） */
  length: number;
  /** 完了文字 */
  filledChar: string;
  /** 未完了文字 */
  emptyChar: string;
}

/**
 * ボタンコンポーネントの設定
 */
export interface ButtonConfig {
  /** ボタンID */
  customId: string;
  /** ラベル */
  label: string;
  /** スタイル */
  style: number;
  /** 無効状態 */
  disabled?: boolean;
  /** 絵文字 */
  emoji?: {
    name: string;
    id?: string;
  };
}

/**
 * インタラクション応答のタイプ
 */
export interface InteractionResponseData {
  /** 応答タイプ */
  type: number;
  /** 応答データ */
  data?: unknown;
}

/**
 * デバウンス処理の設定
 */
export interface DebounceConfig {
  /** デバウンス時間（ミリ秒） */
  delay: number;
  /** 最大待機時間（ミリ秒） */
  maxWait: number;
}

/**
 * セッション実行中のログエントリ
 */
export interface SessionLogEntry {
  /** タイムスタンプ */
  timestamp: Date;
  /** ログレベル */
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** メッセージ */
  message: string;
  /** セッションID */
  sessionId?: string;
  /** 追加データ */
  data?: Record<string, unknown>;
}

/**
 * 実行結果の統計情報
 */
export interface ExecutionStats {
  /** 開始時刻 */
  startTime: Date;
  /** 終了時刻 */
  endTime?: Date;
  /** 実行時間（ミリ秒） */
  duration?: number;
  /** 成功フラグ */
  success: boolean;
  /** エラーメッセージ */
  error?: string;
  /** 変更されたファイル数 */
  modifiedFiles?: number;
  /** 追加行数 */
  linesAdded?: number;
  /** 削除行数 */
  linesDeleted?: number;
}

/**
 * Claude 実行モード
 */
export enum ClaudeExecutionMode {
  /** 継続モード（インタラクティブ） */
  CONTINUOUS = 'continuous',
  /** プリントモード（単一実行） */
  PRINT = 'print',
}

/**
 * Claude 実行設定
 */
export interface ClaudeExecutionConfig {
  /** 実行モード */
  mode: ClaudeExecutionMode;
  /** プロンプト（プリントモード時） */
  prompt?: string;
  /** タイムアウト（秒） */
  timeout: number;
  /** 環境変数 */
  environment?: Record<string, string>;
}

// 既存のDiscordeno型を再エクスポート（利便性のため）
export type { CreateApplicationCommand, Interaction };
