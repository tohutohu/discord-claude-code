// 簡略化されたLogViewコンポーネント
import { Config } from '../config.ts';

/**
 * ログエントリ
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  sessionId?: string;
}

/**
 * ログビューコンポーネント
 */
export class LogView {
  private logs: LogEntry[] = [];
  private currentLevel: Config['logging']['level'];
  // levelPriorityは簡略化のため削除

  constructor(defaultLevel: Config['logging']['level']) {
    this.currentLevel = defaultLevel;

    // デモ用のログデータ
    this.logs = [
      {
        timestamp: '12:01:23',
        level: 'INFO',
        message: 'Clone core-api completed',
      },
      {
        timestamp: '12:02:45',
        level: 'INFO',
        message: 'Starting devcontainer...',
        sessionId: '123',
      },
      {
        timestamp: '12:03:12',
        level: 'DEBUG',
        message: 'Container ID: abc123def',
        sessionId: '123',
      },
      {
        timestamp: '12:03:15',
        level: 'INFO',
        message: 'Claude generating diff...',
        sessionId: '123',
      },
      {
        timestamp: '12:03:45',
        level: 'ERROR',
        message: 'Exit code 1: syntax error',
        sessionId: '456',
      },
    ];
  }

  /**
   * ログレベルを循環切り替え
   */
  cycleLogLevel(): void {
    const levels: Config['logging']['level'][] = [
      'TRACE',
      'DEBUG',
      'INFO',
      'WARN',
      'ERROR',
      'FATAL',
    ];
    const currentIndex = levels.indexOf(this.currentLevel);
    this.currentLevel = levels[(currentIndex + 1) % levels.length] || 'INFO';
  }

  /**
   * 現在のログレベルでフィルタリングされたログを取得
   */
  // 未使用のメソッドを削除

  /**
   * ログビューをレンダリング（簡略化版）
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
   * ログレベルの表示色を取得（実際の実装では色を適用）
   */
  // 未使用のメソッドを削除

  /**
   * 新しいログエントリを追加
   */
  addLog(entry: LogEntry): void {
    this.logs.push(entry);
    // 最大1000件まで保持
    if (this.logs.length > 1000) {
      this.logs.shift();
    }
  }
}
