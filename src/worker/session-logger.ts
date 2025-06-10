import { WorkspaceManager } from "../workspace.ts";

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
  ): Promise<void> {
    if (!repositoryFullName || !sessionId || !output) return;

    try {
      await this.workspaceManager.saveRawSessionJsonl(
        repositoryFullName,
        sessionId,
        output,
      );
    } catch (error) {
      console.error("生JSONLの保存に失敗しました:", error);
    }
  }
}
