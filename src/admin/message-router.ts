import { ClaudeCodeRateLimitError } from "../worker.ts";
import { AuditEntry, WorkspaceManager } from "../workspace.ts";
import { DiscordMessage } from "./types.ts";
import { RateLimitManager } from "./rate-limit-manager.ts";
import { WorkerManager } from "./worker-manager.ts";

export class MessageRouter {
  private workerManager: WorkerManager;
  private rateLimitManager: RateLimitManager;
  private workspaceManager: WorkspaceManager;
  private verbose: boolean;

  constructor(
    workerManager: WorkerManager,
    rateLimitManager: RateLimitManager,
    workspaceManager: WorkspaceManager,
    verbose: boolean = false,
  ) {
    this.workerManager = workerManager;
    this.rateLimitManager = rateLimitManager;
    this.workspaceManager = workspaceManager;
    this.verbose = verbose;
  }

  /**
   * メッセージをルーティングする
   */
  async routeMessage(
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
    messageId?: string,
    authorId?: string,
  ): Promise<string | DiscordMessage> {
    this.logVerbose("メッセージルーティング開始", {
      threadId,
      messageLength: message.length,
      hasProgressCallback: !!onProgress,
      hasReactionCallback: !!onReaction,
    });

    // メッセージ受信確認のリアクションを追加
    if (onReaction) {
      try {
        await onReaction("👀");
        this.logVerbose("メッセージ受信リアクション追加完了", { threadId });
      } catch (error) {
        this.logVerbose("メッセージ受信リアクション追加エラー", {
          threadId,
          error: (error as Error).message,
        });
      }
    }

    // VERBOSEモードでDiscordユーザーメッセージの詳細ログ
    if (this.verbose) {
      console.log(
        `[${
          new Date().toISOString()
        }] [MessageRouter] Discord受信メッセージ詳細:`,
      );
      console.log(`  スレッドID: ${threadId}`);
      console.log(`  メッセージ長: ${message.length}文字`);
      console.log(`  メッセージ内容:`);
      console.log(
        `    ${message.split("\n").map((line) => `    ${line}`).join("\n")}`,
      );
    }

    // レートリミット中か確認
    if (
      await this.rateLimitManager.isRateLimited(threadId) && messageId &&
      authorId
    ) {
      // レートリミット中のメッセージをキューに追加
      await this.rateLimitManager.queueMessage(
        threadId,
        messageId,
        message,
        authorId,
      );
      return "レートリミット中です。このメッセージは制限解除後に自動的に処理されます。";
    }

    const worker = this.workerManager.getWorker(threadId);
    if (!worker) {
      this.logVerbose("Worker見つからず", {
        threadId,
      });
      throw new Error(`Worker not found for thread: ${threadId}`);
    }

    this.logVerbose("Worker発見、処理開始", {
      threadId,
      workerName: worker.getName(),
      hasRepository: !!worker.getRepository(),
      repositoryFullName: worker.getRepository()?.fullName,
    });

    // 最終アクティブ時刻はWorkerのsaveStateで更新される
    this.logVerbose("Worker処理に委譲（最終アクティブ時刻は自動更新）", {
      threadId,
    });

    // 監査ログに記録
    await this.logAuditEntry(threadId, "message_received", {
      messageLength: message.length,
      hasRepository: worker.getRepository() !== null,
    });

    this.logVerbose("Workerにメッセージ処理を委譲", { threadId });

    try {
      const result = await worker.processMessage(
        message,
        onProgress,
        onReaction,
      );

      this.logVerbose("メッセージ処理完了", {
        threadId,
        responseLength: result.length,
      });

      return result;
    } catch (error) {
      if (error instanceof ClaudeCodeRateLimitError) {
        this.logVerbose("Claude Codeレートリミット検出", {
          threadId,
          timestamp: error.timestamp,
        });

        // レートリミット情報をスレッド情報に保存
        await this.rateLimitManager.saveRateLimitInfo(
          threadId,
          error.timestamp,
        );

        // 自動継続確認メッセージを返す
        return this.rateLimitManager.createRateLimitMessage(
          threadId,
          error.timestamp,
        );
      }

      // その他のエラーは再投げ
      throw error;
    }
  }

  /**
   * 監査ログエントリを記録する
   */
  private async logAuditEntry(
    threadId: string,
    action: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const auditEntry: AuditEntry = {
      timestamp: new Date().toISOString(),
      threadId,
      action,
      details,
    };

    try {
      await this.workspaceManager.appendAuditLog(auditEntry);
    } catch (error) {
      console.error("監査ログの記録に失敗しました:", error);
    }
  }

  /**
   * verboseログを出力する
   */
  private logVerbose(
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [MessageRouter] ${message}`;
      console.log(logMessage);

      if (metadata && Object.keys(metadata).length > 0) {
        console.log(
          `[${timestamp}] [MessageRouter] メタデータ:`,
          metadata,
        );
      }
    }
  }
}
