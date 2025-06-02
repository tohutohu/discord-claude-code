/**
 * セッション関連の型定義
 */

/** セッション状態の列挙型 */
export enum SessionState {
  INITIALIZING = 'initializing', // リポジトリclone、worktree作成
  STARTING = 'starting', // devcontainer起動
  READY = 'ready', // Claude実行待機
  RUNNING = 'running', // Claude実行中
  WAITING = 'waiting', // キュー待ち
  ERROR = 'error', // エラー状態
  COMPLETED = 'completed', // 正常終了
  CANCELLED = 'cancelled', // ユーザーによる中断
}

/** セッション状態の日本語表示 */
export const SESSION_STATE_LABELS: Record<SessionState, string> = {
  [SessionState.INITIALIZING]: '初期化中',
  [SessionState.STARTING]: '起動中',
  [SessionState.READY]: '準備完了',
  [SessionState.RUNNING]: '実行中',
  [SessionState.WAITING]: '待機中',
  [SessionState.ERROR]: 'エラー',
  [SessionState.COMPLETED]: '完了',
  [SessionState.CANCELLED]: 'キャンセル',
};

/** セッション状態のアイコン */
export const SESSION_STATE_ICONS: Record<SessionState, string> = {
  [SessionState.INITIALIZING]: '🔄',
  [SessionState.STARTING]: '🚀',
  [SessionState.READY]: '✅',
  [SessionState.RUNNING]: '🟢',
  [SessionState.WAITING]: '⏸️',
  [SessionState.ERROR]: '❌',
  [SessionState.COMPLETED]: '✔️',
  [SessionState.CANCELLED]: '🚫',
};

/** セッションメタデータ */
export interface SessionMetadata {
  /** Discord ユーザーID */
  userId: string;
  /** Discord ギルドID */
  guildId: string;
  /** Discord チャンネルID */
  channelId: string;
  /** 作成時刻 */
  createdAt: Date;
  /** 最終更新時刻 */
  updatedAt: Date;
  /** 優先度（1が最高） */
  priority?: number;
  /** タグ（カテゴリ分け用） */
  tags?: string[];
}

/** セッションデータ */
export interface SessionData {
  /** セッションID（一意識別子） */
  id: string;
  /** Discord スレッドID */
  threadId: string;
  /** リポジトリ名 */
  repository: string;
  /** ブランチ名 */
  branch?: string;
  /** worktreeのパス */
  worktreePath?: string;
  /** Dev Container ID */
  containerId?: string;
  /** 現在の状態 */
  state: SessionState;
  /** エラーメッセージ（ERROR状態の場合） */
  error?: string;
  /** 実行ログ（最新のもの） */
  logs?: string[];
  /** セッションメタデータ */
  metadata: SessionMetadata;
}

/** セッション作成オプション */
export interface CreateSessionOptions {
  /** リポジトリ名 */
  repository: string;
  /** ブランチ名（省略時はデフォルト） */
  branch?: string;
  /** 優先度 */
  priority?: number;
  /** 浅いクローンを使用するか */
  shallow?: boolean;
}

/** セッション更新データ */
export interface SessionUpdate {
  /** 新しい状態 */
  state?: SessionState;
  /** エラーメッセージ */
  error?: string;
  /** worktreeパス */
  worktreePath?: string;
  /** Container ID */
  containerId?: string;
  /** ログを追加 */
  addLogs?: string[];
  /** ログをクリア */
  clearLogs?: boolean;
}

/** セッションイベントの型 */
export interface SessionEvent {
  /** イベントタイプ */
  type: SessionEventType;
  /** セッションID */
  sessionId: string;
  /** セッションデータ */
  session: SessionData;
  /** 前の状態（状態変更時） */
  previousState?: SessionState;
  /** 追加データ */
  data?: Record<string, unknown>;
}

/** セッションイベントタイプ */
export enum SessionEventType {
  CREATED = 'created',
  STATE_CHANGED = 'stateChanged',
  UPDATED = 'updated',
  DELETED = 'deleted',
  LOG_ADDED = 'logAdded',
  ERROR_OCCURRED = 'errorOccurred',
}

/** セッションイベントハンドラ */
export type SessionEventHandler = (event: SessionEvent) => void;

/** セッション一覧フィルター */
export interface SessionFilter {
  /** 状態でフィルタ */
  states?: SessionState[];
  /** ユーザーIDでフィルタ */
  userId?: string;
  /** リポジトリでフィルタ */
  repository?: string;
  /** 作成日時の範囲 */
  createdAfter?: Date;
  createdBefore?: Date;
}

/** セッション統計情報 */
export interface SessionStats {
  /** 総セッション数 */
  total: number;
  /** 状態別の数 */
  byState: Record<SessionState, number>;
  /** アクティブなセッション数（RUNNING + WAITING + READY） */
  active: number;
  /** 平均実行時間（分） */
  avgDuration?: number;
  /** エラー率（%） */
  errorRate?: number;
}

/** 有効な状態遷移のマップ */
export const VALID_STATE_TRANSITIONS: Record<SessionState, SessionState[]> = {
  [SessionState.INITIALIZING]: [
    SessionState.STARTING,
    SessionState.WAITING,
    SessionState.ERROR,
    SessionState.CANCELLED,
  ],
  [SessionState.STARTING]: [
    SessionState.READY,
    SessionState.ERROR,
    SessionState.CANCELLED,
  ],
  [SessionState.READY]: [
    SessionState.RUNNING,
    SessionState.WAITING,
    SessionState.CANCELLED,
  ],
  [SessionState.RUNNING]: [
    SessionState.COMPLETED,
    SessionState.ERROR,
    SessionState.CANCELLED,
  ],
  [SessionState.WAITING]: [
    SessionState.RUNNING,
    SessionState.CANCELLED,
  ],
  [SessionState.ERROR]: [
    SessionState.READY, // 再試行
    SessionState.CANCELLED,
  ],
  [SessionState.COMPLETED]: [
    SessionState.READY, // 新しいタスク
  ],
  [SessionState.CANCELLED]: [], // 終了状態
};

/** 終了状態かどうかを判定 */
export function isTerminalState(state: SessionState): boolean {
  return state === SessionState.COMPLETED || state === SessionState.CANCELLED;
}

/** アクティブ状態かどうかを判定 */
export function isActiveState(state: SessionState): boolean {
  return [
    SessionState.INITIALIZING,
    SessionState.STARTING,
    SessionState.READY,
    SessionState.RUNNING,
    SessionState.WAITING,
  ].includes(state);
}

/** エラー状態かどうかを判定 */
export function isErrorState(state: SessionState): boolean {
  return state === SessionState.ERROR;
}

/** 状態遷移が有効かどうかを判定 */
export function isValidTransition(from: SessionState, to: SessionState): boolean {
  return VALID_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}
