// Discord関連の型定義
export interface DiscordButtonComponent {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  custom_id: string;
  disabled?: boolean;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButtonComponent[];
}

export interface DiscordMessage {
  content: string;
  components?: DiscordActionRow[];
}

// Admin関連のインターフェース
export interface IAdmin {
  createWorker(threadId: string): Promise<import("../worker.ts").IWorker>;
  getWorker(threadId: string): import("../worker.ts").IWorker | null;
  routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
    messageId?: string,
    authorId?: string,
  ): Promise<string | DiscordMessage>;
  handleButtonInteraction(threadId: string, customId: string): Promise<string>;
  createInitialMessage(threadId: string): DiscordMessage;
  createRateLimitMessage(threadId: string, timestamp: number): string;
  terminateThread(threadId: string): Promise<void>;
  restoreActiveThreads(): Promise<void>;
  setAutoResumeCallback(
    callback: (threadId: string, message: string) => Promise<void>,
  ): void;
  setThreadCloseCallback(
    callback: (threadId: string) => Promise<void>,
  ): void;
  save(): Promise<void>;
}
