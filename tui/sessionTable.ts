// 簡略化されたSessionTableコンポーネント

/**
 * セッション情報
 */
export interface SessionInfo {
  id: string;
  threadId: string;
  repository: string;
  status: '🟢 Run' | '⏸️ Wait' | '❌ Err' | '✅ Done';
  uptime: string;
}

/**
 * セッションテーブルコンポーネント
 */
export class SessionTable {
  private sessions: SessionInfo[] = [];
  private selectedIndex = 0;

  constructor() {
    // デモ用のセッションデータ
    this.sessions = [
      {
        id: '1',
        threadId: '123..7890',
        repository: 'core-api',
        status: '🟢 Run',
        uptime: '00:12:34',
      },
      {
        id: '2',
        threadId: '987..3210',
        repository: 'web-admin',
        status: '⏸️ Wait',
        uptime: '00:03:10',
      },
      {
        id: '3',
        threadId: '456..1234',
        repository: 'auth-svc',
        status: '❌ Err',
        uptime: '00:45:23',
      },
    ];
  }

  /**
   * アクティブなセッション数を取得
   */
  getActiveCount(): number {
    return this.sessions.filter((s) => s.status === '🟢 Run' || s.status === '⏸️ Wait').length;
  }

  /**
   * 選択を上に移動
   */
  moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    }
  }

  /**
   * 選択を下に移動
   */
  moveDown(): void {
    if (this.selectedIndex < this.sessions.length - 1) {
      this.selectedIndex++;
    }
  }

  /**
   * テーブルをレンダリング（簡略化版）
   */
  render(
    _x: number,
    _y: number,
    _width: number,
    _height: number,
  ): { draw: () => void; addChild: () => void } {
    // 簡略化された実装のため、オブジェクトを返す
    return {
      draw: () => {}, // ダミー関数
      addChild: () => {}, // ダミー関数
    };
  }

  /**
   * 文字列を指定長にパディング
   */
  // 未使用のメソッドを削除
}
