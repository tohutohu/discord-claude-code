import { WorkspaceManager } from "../workspace.ts";
import { err, ok, Result } from "neverthrow";
import type { SessionLoggerError } from "./types.ts";
import type {
  InterruptionInfo,
  SessionLog,
} from "../workspace/schemas/session-schema.ts";

/**
 * セッションログ管理を担当するクラス
 */
export class SessionLogger {
  private readonly workspaceManager: WorkspaceManager;

  constructor(workspaceManager: WorkspaceManager) {
    this.workspaceManager = workspaceManager;
  }

  /**
   * 生のJSONL出力を保存
   */
  async saveRawJsonlOutput(
    repositoryFullName?: string,
    sessionId?: string,
    output?: string,
  ): Promise<Result<void, SessionLoggerError>> {
    if (!repositoryFullName || !sessionId || !output) {
      return ok(undefined);
    }

    try {
      await this.workspaceManager.saveRawSessionJsonl(
        repositoryFullName,
        sessionId,
        output,
      );
      return ok(undefined);
    } catch (error) {
      console.error("生JSONLの保存に失敗しました:", error);
      return err({
        type: "SAVE_FAILED",
        error: (error as Error).message,
      });
    }
  }

  /**
   * 中断イベントを保存
   */
  async saveInterruptionEvent(
    repositoryFullName: string,
    sessionId: string,
    interruption: InterruptionInfo,
  ): Promise<Result<void, SessionLoggerError>> {
    const sessionLog: SessionLog = {
      timestamp: new Date().toISOString(),
      sessionId,
      type: "interruption",
      content: `実行が中断されました。理由: ${interruption.reason}`,
      interruption,
    };

    try {
      // SessionLogをJSONL形式に変換
      const jsonlLine = JSON.stringify(sessionLog);

      // 既存のセッションファイルに追記
      await this.workspaceManager.saveRawSessionJsonl(
        repositoryFullName,
        sessionId,
        jsonlLine,
      );
      return ok(undefined);
    } catch (error) {
      console.error("中断イベントの保存に失敗しました:", error);
      return err({
        type: "SAVE_FAILED",
        error: (error as Error).message,
      });
    }
  }
}
