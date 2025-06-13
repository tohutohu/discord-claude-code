import { WorkspaceManager } from "../workspace.ts";
import { err, ok, Result } from "neverthrow";
import type { SessionLoggerError } from "./types.ts";

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
}
