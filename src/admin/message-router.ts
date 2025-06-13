import { type IWorker } from "../worker.ts";
import { WorkspaceManager } from "../workspace.ts";
import type { AuditEntry } from "../workspace.ts";
import type { DiscordMessage } from "./types.ts";
import { RateLimitManager } from "./rate-limit-manager.ts";
import { WorkerManager } from "./worker-manager.ts";
import { err, ok, Result } from "neverthrow";

// エラー型定義
export type MessageRouterError =
  | { type: "WORKER_NOT_FOUND"; threadId: string }
  | { type: "RATE_LIMIT_ERROR"; threadId: string; timestamp: number }
  | { type: "MESSAGE_PROCESSING_ERROR"; threadId: string; error: string };

export class MessageRouter {
  private workerManager: WorkerManager;
  private rateLimitManager: RateLimitManager;
  private workspaceManager: WorkspaceManager;
  private verbose: boolean;

  constructor(
    workerManager: WorkerManager,
    rateLimitManager: RateLimitManager,
    workspaceManager: WorkspaceManager,
    verbose = false,
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
  ): Promise<Result<string | DiscordMessage, MessageRouterError>> {
    this.logVerbose("メッセージルーティング開始", {
      threadId,
      messageLength: message.length,
      hasProgressCallback: !!onProgress,
      hasReactionCallback: !!onReaction,
    });

    // メッセージ受信確認のリアクションを追加
    await this.addMessageReceivedReaction(threadId, onReaction);

    // VERBOSEモードでの詳細ログ出力
    this.logMessageDetails(threadId, message);

    // レートリミット確認と処理
    const rateLimitResult = await this.checkAndHandleRateLimit(
      threadId,
      messageId,
      authorId,
      message,
    );
    if (rateLimitResult) {
      return ok(rateLimitResult);
    }

    // スレッド用のWorker取得
    const workerResult = this.findWorkerForThread(threadId);
    if (workerResult.isErr()) {
      return err(workerResult.error);
    }
    const worker = workerResult.value;

    // 監査ログに記録
    await this.logAuditEntry(threadId, "message_received", {
      messageLength: message.length,
      hasRepository: worker.getRepository() !== null,
    });

    this.logVerbose("Workerにメッセージ処理を委譲", { threadId });

    // Workerへの処理委譲
    const delegateResult = await this.delegateToWorker(
      worker,
      threadId,
      message,
      onProgress,
      onReaction,
    );

    if (delegateResult.isErr()) {
      if (delegateResult.error.type === "RATE_LIMIT_ERROR") {
        // レートリミットエラーのハンドリング
        const rateLimitMessage = await this.handleRateLimitError(
          threadId,
          delegateResult.error.timestamp,
        );
        return ok(rateLimitMessage);
      }
      return err(delegateResult.error);
    }

    return ok(delegateResult.value);
  }

  /**
   * メッセージ受信リアクションを追加する
   */
  private async addMessageReceivedReaction(
    threadId: string,
    onReaction?: (emoji: string) => Promise<void>,
  ): Promise<void> {
    if (!onReaction) {
      return;
    }

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

  /**
   * VERBOSEモードでの詳細ログを出力する
   */
  private logMessageDetails(threadId: string, message: string): void {
    if (!this.verbose) {
      return;
    }

    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] [MessageRouter] Discord受信メッセージ詳細:`,
    );
    console.log(`  スレッドID: ${threadId}`);
    console.log(`  メッセージ長: ${message.length}文字`);
    console.log("  メッセージ内容:");
    console.log(
      `    ${message.split("\n").map((line) => `    ${line}`).join("\n")}`,
    );
  }

  /**
   * レートリミット状態を確認し、必要に応じて処理する
   */
  private async checkAndHandleRateLimit(
    threadId: string,
    messageId?: string,
    authorId?: string,
    message?: string,
  ): Promise<string | null> {
    const isRateLimited = await this.rateLimitManager.isRateLimited(threadId);

    if (!isRateLimited || !messageId || !authorId) {
      return null;
    }

    // レートリミット中のメッセージをキューに追加
    await this.rateLimitManager.queueMessage(
      threadId,
      messageId,
      message || "",
      authorId,
    );

    return "レートリミット中です。このメッセージは制限解除後に自動的に処理されます。";
  }

  /**
   * スレッド用のWorkerを取得する
   */
  private findWorkerForThread(
    threadId: string,
  ): Result<IWorker, MessageRouterError> {
    const worker = this.workerManager.getWorker(threadId);

    if (!worker) {
      this.logVerbose("Worker見つからず", { threadId });
      return err({ type: "WORKER_NOT_FOUND", threadId });
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

    return ok(worker);
  }

  /**
   * Workerへメッセージ処理を委譲する
   */
  private async delegateToWorker(
    worker: IWorker,
    threadId: string,
    message: string,
    onProgress?: (content: string) => Promise<void>,
    onReaction?: (emoji: string) => Promise<void>,
  ): Promise<Result<string, MessageRouterError>> {
    const result = await worker.processMessage(
      message,
      onProgress,
      onReaction,
    );

    if (result.isErr()) {
      const error = result.error;
      if (error.type === "RATE_LIMIT") {
        return err({
          type: "RATE_LIMIT_ERROR",
          threadId,
          timestamp: error.timestamp,
        });
      } else if (error.type === "REPOSITORY_NOT_SET") {
        return ok(
          "リポジトリが設定されていません。/start コマンドでリポジトリを指定してください。",
        );
      } else if (error.type === "CONFIGURATION_INCOMPLETE") {
        let message = "⚠️ **Claude Code実行環境の設定が必要です**\n\n";
        message += "**実行環境を選択してください:**\n";
        message +=
          "• `/config devcontainer on` - devcontainer環境で実行（推奨）\n";
        message += "• `/config devcontainer off` - ホスト環境で実行\n\n";
        message += "設定が完了すると、Claude Codeを実行できるようになります。";
        return ok(message);
      } else {
        // その他のエラーの場合
        switch (error.type) {
          case "CLAUDE_EXECUTION_FAILED":
          case "WORKSPACE_ERROR":
          case "STREAM_PROCESSING_ERROR":
          case "TRANSLATION_FAILED":
          case "SESSION_LOG_FAILED":
          case "DEVCONTAINER_START_FAILED":
            return ok(`エラーが発生しました: ${error.error}`);
          default:
            // Never型になるはずなので、全てのケースがカバーされている
            return error satisfies never;
        }
      }
    }

    const responseText = result.value;
    this.logVerbose("メッセージ処理完了", {
      threadId,
      responseLength: responseText.length,
    });

    return ok(responseText);
  }

  /**
   * レートリミットエラーをハンドリングする
   */
  private async handleRateLimitError(
    threadId: string,
    timestamp: number,
  ): Promise<string | DiscordMessage> {
    this.logVerbose("Claude Codeレートリミット検出", {
      threadId,
      timestamp,
    });

    // レートリミット情報をスレッド情報に保存
    await this.rateLimitManager.saveRateLimitInfo(
      threadId,
      timestamp,
    );

    // 自動継続確認メッセージを返す
    return this.rateLimitManager.createRateLimitMessage(
      threadId,
      timestamp,
    );
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
