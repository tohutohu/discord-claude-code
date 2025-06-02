/**
 * セッション一覧テーブルコンポーネント
 */

import { tui } from '../deps.ts';

/** セッション情報の型 */
export interface SessionInfo {
  id: string;
  threadId: string;
  repository: string;
  status: SessionStatus;
  uptime: number;
  memory?: number;
}

/** セッションステータスの型 */
export type SessionStatus =
  | 'initializing'
  | 'starting'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'error'
  | 'completed'
  | 'cancelled';

/** ステータスアイコンのマッピング */
const STATUS_ICONS: Record<SessionStatus, string> = {
  initializing: '🔄',
  starting: '🚀',
  ready: '✅',
  running: '🟢',
  waiting: '⏸️',
  error: '❌',
  completed: '✔️',
  cancelled: '🚫',
};

/** ステータスの色マッピング */
const STATUS_COLORS: Record<SessionStatus, string> = {
  initializing: 'yellow',
  starting: 'cyan',
  ready: 'green',
  running: 'green',
  waiting: 'yellow',
  error: 'red',
  completed: 'gray',
  cancelled: 'gray',
};

/**
 * セッションテーブルクラス
 */
export class SessionTable {
  private table: tui.ListTable;
  private sessions: SessionInfo[] = [];

  constructor(options: tui.BoxOptions) {
    // テーブルを作成
    this.table = tui.listtable({
      ...options,
      keys: true,
      mouse: true,
      vi: true,
      style: {
        selected: {
          bg: 'blue',
        },
        header: {
          fg: 'cyan',
          bold: true,
        },
        cell: {
          fg: 'white',
        },
      },
      border: {
        type: 'line',
      },
      scrollbar: {
        style: {
          bg: 'gray',
        },
      },
    });

    // ヘッダーを設定
    this.updateTable();

    // イベントハンドラを設定
    this.setupEventHandlers();
  }

  /**
   * イベントハンドラを設定する
   */
  private setupEventHandlers(): void {
    // Enterキーで詳細表示
    this.table.key('enter', () => {
      const selected = this.table.selected;
      if (selected > 0 && selected <= this.sessions.length) {
        const session = this.sessions[selected - 1];
        this.showSessionDetails(session);
      }
    });

    // dキーでセッション終了
    this.table.key('d', () => {
      const selected = this.table.selected;
      if (selected > 0 && selected <= this.sessions.length) {
        const session = this.sessions[selected - 1];
        this.confirmEndSession(session);
      }
    });

    // rキーでセッション再起動
    this.table.key('r', () => {
      const selected = this.table.selected;
      if (selected > 0 && selected <= this.sessions.length) {
        const session = this.sessions[selected - 1];
        this.confirmRestartSession(session);
      }
    });
  }

  /**
   * テーブルを更新する
   */
  private updateTable(): void {
    const headers = ['選択', 'Thread ID', 'リポジトリ', 'ステータス', '稼働時間'];
    const data = [headers];

    // セッションデータを追加
    this.sessions.forEach((session, index) => {
      const row = [
        index === this.table.selected - 1 ? '▶' : ' ',
        session.threadId.substring(0, 10) + '...',
        session.repository,
        `${STATUS_ICONS[session.status]} ${this.formatStatus(session.status)}`,
        this.formatUptime(session.uptime),
      ];
      data.push(row);
    });

    // データが空の場合
    if (this.sessions.length === 0) {
      data.push(['', '(アクティブなセッションはありません)', '', '', '']);
    }

    this.table.setData(data);
  }

  /**
   * ステータスをフォーマットする
   * @param status ステータス
   * @returns フォーマットされたステータス
   */
  private formatStatus(status: SessionStatus): string {
    const statusText: Record<SessionStatus, string> = {
      initializing: '初期化中',
      starting: '起動中',
      ready: '準備完了',
      running: '実行中',
      waiting: '待機中',
      error: 'エラー',
      completed: '完了',
      cancelled: 'キャンセル',
    };

    return statusText[status] || status;
  }

  /**
   * 稼働時間をフォーマットする
   * @param seconds 秒数
   * @returns フォーマットされた時間
   */
  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:` +
      `${minutes.toString().padStart(2, '0')}:` +
      `${secs.toString().padStart(2, '0')}`;
  }

  /**
   * セッション詳細を表示する
   * @param session セッション情報
   */
  private showSessionDetails(session: SessionInfo): void {
    const detailBox = tui.box({
      parent: this.table.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '60%',
      content: this.getSessionDetailsContent(session),
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });

    detailBox.key(['escape', 'q'], () => {
      detailBox.destroy();
      this.table.screen.render();
    });

    detailBox.focus();
    this.table.screen.render();
  }

  /**
   * セッション詳細コンテンツを生成する
   * @param session セッション情報
   * @returns 詳細文字列
   */
  private getSessionDetailsContent(session: SessionInfo): string {
    return `{center}{bold}セッション詳細{/bold}{/center}\n\n` +
      `{bold}ID:{/bold} ${session.id}\n` +
      `{bold}Thread ID:{/bold} ${session.threadId}\n` +
      `{bold}リポジトリ:{/bold} ${session.repository}\n` +
      `{bold}ステータス:{/bold} ${STATUS_ICONS[session.status]} ${
        this.formatStatus(session.status)
      }\n` +
      `{bold}稼働時間:{/bold} ${this.formatUptime(session.uptime)}\n` +
      `{bold}メモリ使用量:{/bold} ${session.memory ? `${session.memory}MB` : 'N/A'}\n\n` +
      `{center}{gray}ESCまたはqで閉じる{/gray}{/center}`;
  }

  /**
   * セッション終了の確認を表示する
   * @param session セッション情報
   */
  private confirmEndSession(session: SessionInfo): void {
    const confirmBox = tui.question({
      parent: this.table.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      content: `セッション ${session.repository} を終了しますか？`,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
      },
    });

    confirmBox.ask((err: Error | null, value: boolean) => {
      if (!err && value) {
        // TODO(@session): セッション終了処理
        this.removeSession(session.id);
      }
      this.table.screen.render();
    });
  }

  /**
   * セッション再起動の確認を表示する
   * @param session セッション情報
   */
  private confirmRestartSession(session: SessionInfo): void {
    const confirmBox = tui.question({
      parent: this.table.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 'shrink',
      content: `セッション ${session.repository} を再起動しますか？`,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'yellow',
        },
      },
    });

    confirmBox.ask((err: Error | null, value: boolean) => {
      if (!err && value) {
        // TODO(@session): セッション再起動処理
        this.updateSession(session.id, { status: 'starting' });
      }
      this.table.screen.render();
    });
  }

  /**
   * セッションを追加する
   * @param session セッション情報
   */
  addSession(session: SessionInfo): void {
    this.sessions.push(session);
    this.updateTable();
  }

  /**
   * セッションを更新する
   * @param id セッションID
   * @param updates 更新内容
   */
  updateSession(id: string, updates: Partial<SessionInfo>): void {
    const index = this.sessions.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.sessions[index] = { ...this.sessions[index], ...updates };
      this.updateTable();
    }
  }

  /**
   * セッションを削除する
   * @param id セッションID
   */
  removeSession(id: string): void {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.updateTable();
  }

  /**
   * セッション数を取得する
   * @returns セッション数
   */
  getSessionCount(): number {
    return this.sessions.length;
  }

  /**
   * リフレッシュする
   */
  refresh(): void {
    // 稼働時間を更新
    this.sessions.forEach((session) => {
      if (session.status === 'running' || session.status === 'waiting') {
        session.uptime += 1;
      }
    });

    this.updateTable();
  }

  /**
   * フォーカスを取得する
   */
  focus(): void {
    this.table.focus();
  }

  /**
   * フォーカスを外す
   */
  blur(): void {
    this.table.blur();
  }

  /**
   * フォーカス状態を取得する
   */
  get focused(): boolean {
    return this.table.focused;
  }
}
