// Discord クライアント管理モジュール
// Discordeno を使用したBot初期化・接続・再接続処理を担当

import { Bot, createBot } from '../deps.ts';
import { delay } from '../deps.ts';

/**
 * Discord Bot の設定インターフェース
 */
export interface DiscordBotConfig {
  /** Discord Bot Token */
  token: string;
  /** アプリケーションID */
  applicationId: bigint;
  /** 対象ギルドIDリスト（空の場合は全ギルド） */
  guildIds?: bigint[];
  /** コマンドプレフィックス */
  commandPrefix?: string;
}

/**
 * 再接続設定
 */
interface ReconnectConfig {
  /** 最大再試行回数 */
  maxRetries: number;
  /** 初期遅延時間（ミリ秒） */
  baseDelay: number;
  /** 最大遅延時間（ミリ秒） */
  maxDelay: number;
  /** 指数バックオフの倍率 */
  backoffMultiplier: number;
}

/**
 * Discord Bot クライアント管理クラス
 * 接続・再接続・イベントハンドリングを管理
 */
export class DiscordClient {
  private bot: Bot | null = null;
  private config: DiscordBotConfig;
  private reconnectConfig: ReconnectConfig;
  private reconnectAttempts = 0;
  private isConnected = false;
  private shouldReconnect = true;

  constructor(config: DiscordBotConfig) {
    this.config = config;
    this.reconnectConfig = {
      maxRetries: 5,
      baseDelay: 1000, // 1秒
      maxDelay: 30000, // 30秒
      backoffMultiplier: 2,
    };
  }

  /**
   * Bot を初期化して接続を開始
   */
  async connect(): Promise<void> {
    try {
      this.createBot();
      await this.startBot();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('Discord Bot に正常に接続しました');
    } catch (error) {
      console.error('Discord Bot 接続エラー:', error);
      if (this.shouldReconnect && this.reconnectAttempts < this.reconnectConfig.maxRetries) {
        await this.attemptReconnect();
      } else {
        throw error;
      }
    }
  }

  /**
   * Bot との接続を切断
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.isConnected = false;
    // Discordeno には明示的な disconnect メソッドがないため、
    // プロセス終了時にはprocess.exit()で処理
    console.log('Discord Bot 接続を切断しました');
  }

  /**
   * Bot インスタンスを取得
   */
  getBot(): Bot | null {
    return this.bot;
  }

  /**
   * 接続状態を取得
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Bot インスタンスを作成
   */
  private createBot(): void {
    this.bot = createBot({
      token: this.config.token,
      // v21では intents の形式が異なる
      // 一時的にコメントアウトして基本的な Bot を作成
      events: {
        // Bot準備完了イベント
        ready: () => {
          console.log('Discord Bot が準備完了しました');
          this.isConnected = true;
        },
      },
    });

    // TODO(v21): Discordeno v21でのintentsとイベント設定を修正
  }

  /**
   * Bot を開始
   */
  private async startBot(): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot が初期化されていません');
    }
    await this.bot.start();
  }

  /**
   * 指数バックオフによる再接続試行
   */
  private async attemptReconnect(): Promise<void> {
    if (!this.shouldReconnect || this.reconnectAttempts >= this.reconnectConfig.maxRetries) {
      console.error(`再接続試行が上限に達しました (${this.reconnectConfig.maxRetries}回)`);
      return;
    }

    this.reconnectAttempts++;

    // 指数バックオフによる遅延計算
    const delayMs = Math.min(
      this.reconnectConfig.baseDelay *
        Math.pow(this.reconnectConfig.backoffMultiplier, this.reconnectAttempts - 1),
      this.reconnectConfig.maxDelay,
    );

    console.log(
      `${delayMs}ms 後に再接続を試行します (${this.reconnectAttempts}/${this.reconnectConfig.maxRetries})`,
    );

    await delay(delayMs);

    try {
      this.createBot();
      await this.startBot();
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('再接続に成功しました');
    } catch (error) {
      console.error(`再接続試行 ${this.reconnectAttempts} が失敗:`, error);
      // 再帰的に再試行
      await this.attemptReconnect();
    }
  }

  /**
   * 再接続設定を更新
   */
  updateReconnectConfig(config: Partial<ReconnectConfig>): void {
    this.reconnectConfig = { ...this.reconnectConfig, ...config };
  }
}

/**
 * Discord クライアントのシングルトンインスタンス
 * アプリケーション全体で共有される
 */
let discordClientInstance: DiscordClient | null = null;

/**
 * Discord クライアントを初期化
 */
export function initializeDiscordClient(config: DiscordBotConfig): DiscordClient {
  if (discordClientInstance) {
    throw new Error('Discord クライアントは既に初期化されています');
  }

  discordClientInstance = new DiscordClient(config);
  return discordClientInstance;
}

/**
 * 初期化済みの Discord クライアントを取得
 */
export function getDiscordClient(): DiscordClient {
  if (!discordClientInstance) {
    throw new Error('Discord クライアントが初期化されていません');
  }
  return discordClientInstance;
}

/**
 * Discord クライアントを破棄
 */
export function destroyDiscordClient(): void {
  if (discordClientInstance) {
    discordClientInstance.disconnect();
    discordClientInstance = null;
  }
}
