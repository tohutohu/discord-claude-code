import {
  checkDevcontainerCli,
  checkDevcontainerConfig,
  startFallbackDevcontainer,
} from "../devcontainer.ts";
import type { Worker } from "../worker.ts";
import type { AuditEntry } from "../workspace.ts";
import { WorkspaceManager } from "../workspace.ts";
import type { DiscordActionRow } from "./types.ts";

export class DevcontainerManager {
  private workspaceManager: WorkspaceManager;
  private verbose: boolean;

  constructor(
    workspaceManager: WorkspaceManager,
    verbose = false,
  ) {
    this.workspaceManager = workspaceManager;
    this.verbose = verbose;
  }

  /**
   * リポジトリにdevcontainer.jsonが存在するかチェックし、存在する場合は起動確認を行う
   */
  async checkAndSetupDevcontainer(
    threadId: string,
    repositoryPath: string,
  ): Promise<{
    hasDevcontainer: boolean;
    message: string;
    components?: DiscordActionRow[];
    useDevcontainer?: boolean;
    warning?: string;
  }> {
    this.logVerbose("devcontainer設定チェック開始", {
      threadId,
      repositoryPath,
    });

    const devcontainerInfo = await this.checkDevcontainerExistence(
      repositoryPath,
      threadId,
    );

    if (!devcontainerInfo.configExists) {
      return await this.handleNoDevcontainerCase(threadId);
    }

    // devcontainer CLIの確認
    const hasDevcontainerCli = await checkDevcontainerCli();
    this.logVerbose("devcontainer CLI確認完了", {
      threadId,
      hasDevcontainerCli,
    });

    if (!hasDevcontainerCli) {
      return await this.handleNoCliCase(
        threadId,
        devcontainerInfo.hasAnthropicsFeature ?? false,
      );
    }

    return await this.prepareDevcontainerResponse(
      threadId,
      devcontainerInfo.hasAnthropicsFeature ?? false,
    );
  }

  /**
   * devcontainer.jsonの存在を確認する
   */
  private async checkDevcontainerExistence(
    repositoryPath: string,
    threadId: string,
  ): Promise<{
    configExists: boolean;
    hasAnthropicsFeature?: boolean;
  }> {
    const devcontainerInfo = await checkDevcontainerConfig(repositoryPath);
    this.logVerbose("devcontainer.json存在確認完了", {
      threadId,
      configExists: devcontainerInfo.configExists,
      hasAnthropicsFeature: devcontainerInfo.hasAnthropicsFeature,
    });
    return devcontainerInfo;
  }

  /**
   * devcontainer.jsonが存在しない場合の処理
   */
  private async handleNoDevcontainerCase(
    threadId: string,
  ): Promise<{
    hasDevcontainer: boolean;
    message: string;
    components?: DiscordActionRow[];
  }> {
    this.logVerbose("devcontainer.json未発見", {
      threadId,
    });

    // devcontainer CLIの確認
    const hasDevcontainerCli = await checkDevcontainerCli();

    if (!hasDevcontainerCli) {
      // devcontainer CLI未インストールの場合
      const config = {
        useDevcontainer: false,
        hasDevcontainerFile: false,
        hasAnthropicsFeature: false,
        isStarted: false,
      };
      await this.saveDevcontainerConfig(threadId, config);

      return this.createLocalEnvResponse(threadId);
    }

    // devcontainer CLIがインストールされている場合
    return this.createFallbackDevcontainerResponse(threadId);
  }

  /**
   * devcontainer CLIがインストールされていない場合の処理
   */
  private async handleNoCliCase(
    threadId: string,
    hasAnthropicsFeature: boolean,
  ): Promise<{
    hasDevcontainer: boolean;
    message: string;
    components?: DiscordActionRow[];
    warning?: string;
  }> {
    this.logVerbose("devcontainer CLI未インストール、ローカル環境で実行", {
      threadId,
    });

    // devcontainer設定情報を保存（CLI未インストール）
    const config = {
      useDevcontainer: false,
      hasDevcontainerFile: true,
      hasAnthropicsFeature: hasAnthropicsFeature,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return {
      hasDevcontainer: true,
      message:
        "devcontainer.jsonが見つかりましたが、devcontainer CLIがインストールされていません。通常のローカル環境でClaudeを実行します。\n\n`--dangerously-skip-permissions`オプションを使用しますか？（権限チェックをスキップします。注意して使用してください）",
      components: [this.createPermissionButtons(threadId)],
      warning:
        "devcontainer CLIをインストールしてください: npm install -g @devcontainers/cli",
    };
  }

  /**
   * devcontainer使用の選択肢を準備する
   */
  private async prepareDevcontainerResponse(
    threadId: string,
    hasAnthropicsFeature: boolean,
  ): Promise<{
    hasDevcontainer: boolean;
    message: string;
    components?: DiscordActionRow[];
    warning?: string;
  }> {
    // anthropics featureの確認
    let warningMessage = "";
    if (!hasAnthropicsFeature) {
      warningMessage =
        "⚠️ 警告: anthropics/devcontainer-featuresが設定に含まれていません。Claude CLIが正常に動作しない可能性があります。";
    }

    this.logVerbose("devcontainer設定チェック完了、選択肢を提示", {
      threadId,
      hasAnthropicsFeature: hasAnthropicsFeature,
      hasWarning: !!warningMessage,
    });

    // devcontainer設定情報を保存（ファイル存在状況とfeature情報のみ）
    const config = {
      useDevcontainer: false, // まだ選択されていない
      hasDevcontainerFile: true,
      hasAnthropicsFeature: hasAnthropicsFeature,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return {
      hasDevcontainer: true,
      message:
        `devcontainer.jsonが見つかりました。devcontainer内でClaudeを実行しますか？\n\n**確認事項:**\n- devcontainer CLI: ✅ 利用可能\n- Anthropics features: ${
          hasAnthropicsFeature ? "✅" : "❌"
        }\n\n下のボタンで選択してください：`,
      components: [this.createDevcontainerButtons(threadId)],
      warning: warningMessage,
    };
  }

  /**
   * ローカル環境の選択肢を作成する
   */
  private createLocalEnvResponse(
    threadId: string,
  ): {
    hasDevcontainer: boolean;
    message: string;
    components: DiscordActionRow[];
  } {
    return {
      hasDevcontainer: false,
      message:
        "devcontainer.jsonが見つかりませんでした。通常のローカル環境でClaudeを実行します。\n\n`--dangerously-skip-permissions`オプションを使用しますか？（権限チェックをスキップします。注意して使用してください）",
      components: [this.createPermissionButtons(threadId)],
    };
  }

  /**
   * fallback devcontainerの選択肢を作成する
   */
  private createFallbackDevcontainerResponse(
    threadId: string,
  ): {
    hasDevcontainer: boolean;
    message: string;
    components: DiscordActionRow[];
  } {
    return {
      hasDevcontainer: false,
      message:
        "devcontainer.jsonが見つかりませんでした。\n\n以下のオプションから選択してください：\n1. 通常のローカル環境でClaudeを実行\n2. fallback devcontainerを使用（標準的な開発環境をコンテナで提供）",
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: "ローカル環境で実行",
              custom_id: `local_env_${threadId}`,
            },
            {
              type: 2,
              style: 1,
              label: "fallback devcontainerを使用",
              custom_id: `fallback_devcontainer_${threadId}`,
            },
          ],
        },
      ],
    };
  }

  /**
   * 権限チェック選択ボタンを作成する
   */
  private createPermissionButtons(threadId: string): DiscordActionRow {
    return {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "権限チェックあり",
          custom_id: `permissions_no_skip_${threadId}`,
        },
        {
          type: 2,
          style: 2,
          label: "権限チェックスキップ",
          custom_id: `permissions_skip_${threadId}`,
        },
      ],
    };
  }

  /**
   * devcontainer使用選択ボタンを作成する
   */
  private createDevcontainerButtons(threadId: string): DiscordActionRow {
    return {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "devcontainer使用",
          custom_id: `devcontainer_yes_${threadId}`,
        },
        {
          type: 2,
          style: 2,
          label: "ローカル環境",
          custom_id: `devcontainer_no_${threadId}`,
        },
      ],
    };
  }

  /**
   * devcontainerの起動を処理する
   */
  async startDevcontainerForWorker(
    threadId: string,
    worker: Worker,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logVerbose("devcontainer起動処理開始", {
      threadId,
      hasProgressCallback: !!onProgress,
      workerName: worker.getName(),
    });

    worker.setUseDevcontainer(true);

    this.logVerbose("Workerにdevcontainer起動を委譲", { threadId });
    const result = await worker.startDevcontainer(onProgress);

    this.logVerbose("devcontainer起動結果", {
      threadId,
      success: result.success,
      hasContainerId: !!result.containerId,
      hasError: !!result.error,
    });

    if (result.success) {
      // devcontainer設定情報を更新（起動状態とcontainerId）
      const existingConfig = await this.getDevcontainerConfig(threadId);
      if (existingConfig) {
        const updatedConfig = {
          ...existingConfig,
          containerId: result.containerId || "unknown",
          isStarted: true,
        };
        await this.saveDevcontainerConfig(threadId, updatedConfig);
      }

      await this.logAuditEntry(threadId, "devcontainer_started", {
        containerId: result.containerId || "unknown",
      });

      this.logVerbose("devcontainer起動成功、監査ログ記録完了", {
        threadId,
        containerId: result.containerId,
      });

      return {
        success: true,
        message:
          "devcontainerが正常に起動しました。Claude実行環境が準備完了です。",
      };
    }
    await this.logAuditEntry(threadId, "devcontainer_start_failed", {
      error: result.error,
    });

    this.logVerbose("devcontainer起動失敗、監査ログ記録完了", {
      threadId,
      error: result.error,
    });

    return {
      success: false,
      message: `devcontainerの起動に失敗しました: ${result.error}`,
    };
  }

  /**
   * fallback devcontainerを起動する
   */
  async startFallbackDevcontainerForWorker(
    threadId: string,
    repositoryPath: string,
    onProgress?: (message: string) => Promise<void>,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logVerbose("fallback devcontainer起動開始", {
      threadId,
      repositoryPath,
      hasOnProgress: !!onProgress,
    });

    // Workerのworktreeパスを取得
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    const worktreePath = workerState?.worktreePath || repositoryPath;

    this.logVerbose("fallback devcontainer起動パス決定", {
      threadId,
      repositoryPath,
      worktreePath,
      isWorktreePath: worktreePath !== repositoryPath,
    });

    // fallback devcontainerを起動（worktreePathを使用）
    const result = await startFallbackDevcontainer(
      worktreePath,
      onProgress,
    );

    this.logVerbose("fallback devcontainer起動結果", {
      threadId,
      success: result.success,
      hasContainerId: !!result.containerId,
      hasError: !!result.error,
    });

    if (result.success) {
      // devcontainer設定情報を更新（起動状態とcontainerId）
      const existingConfig = await this.getDevcontainerConfig(threadId);
      if (existingConfig) {
        const updatedConfig = {
          ...existingConfig,
          containerId: result.containerId || "unknown",
          isStarted: true,
        };
        await this.saveDevcontainerConfig(threadId, updatedConfig);
      }

      await this.logAuditEntry(threadId, "fallback_devcontainer_started", {
        containerId: result.containerId || "unknown",
      });

      this.logVerbose("fallback devcontainer起動成功、監査ログ記録完了", {
        threadId,
        containerId: result.containerId,
      });

      // WorkerにDevcontainerClaudeExecutorへの切り替えを通知
      // この時点でWorkerは既にuseDevcontainer=trueになっているが、
      // DevcontainerClaudeExecutorへの切り替えはWorker側で行う必要がある
      // WorkerのstartDevcontainerメソッドを呼び出すか、別の方法で通知する必要がある

      return {
        success: true,
        message:
          "fallback devcontainerが正常に起動しました。Claude実行環境が準備完了です。",
      };
    }
    await this.logAuditEntry(threadId, "fallback_devcontainer_start_failed", {
      error: result.error,
    });

    this.logVerbose("fallback devcontainer起動失敗、監査ログ記録完了", {
      threadId,
      error: result.error,
    });

    return {
      success: false,
      message: `fallback devcontainerの起動に失敗しました: ${result.error}`,
    };
  }

  /**
   * devcontainer使用ボタンの処理
   */
  async handleDevcontainerYesButton(
    threadId: string,
    worker: Worker,
  ): Promise<string> {
    worker.setUseDevcontainer(true);

    // devcontainer設定情報を保存
    const existingConfig = await this.getDevcontainerConfig(threadId);
    const config = {
      useDevcontainer: true,
      hasDevcontainerFile: existingConfig?.hasDevcontainerFile ?? false,
      hasAnthropicsFeature: existingConfig?.hasAnthropicsFeature ?? false,
      containerId: existingConfig?.containerId,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    // devcontainerを起動 (進捗コールバックはmain.tsから渡される)
    return "devcontainer_start_with_progress";
  }

  /**
   * ローカル環境使用ボタンの処理
   */
  async handleDevcontainerNoButton(
    threadId: string,
    worker: Worker,
  ): Promise<string> {
    worker.setUseDevcontainer(false);

    // devcontainer設定情報を保存
    const existingConfig = await this.getDevcontainerConfig(threadId);
    const config = {
      useDevcontainer: false,
      hasDevcontainerFile: existingConfig?.hasDevcontainerFile ?? false,
      hasAnthropicsFeature: existingConfig?.hasAnthropicsFeature ?? false,
      containerId: existingConfig?.containerId,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return "通常のローカル環境でClaude実行を設定しました。\n\n準備完了です！何かご質問をどうぞ。";
  }

  /**
   * ローカル環境選択ボタンの処理
   */
  async handleLocalEnvButton(
    threadId: string,
    worker: Worker,
  ): Promise<string> {
    worker.setUseDevcontainer(false);

    // devcontainer設定情報を保存
    const config = {
      useDevcontainer: false,
      hasDevcontainerFile: false,
      hasAnthropicsFeature: false,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    return "通常のローカル環境でClaudeを実行します。";
  }

  /**
   * fallback devcontainer選択ボタンの処理
   */
  async handleFallbackDevcontainerButton(
    threadId: string,
    worker: Worker,
  ): Promise<string> {
    worker.setUseDevcontainer(true);
    worker.setUseFallbackDevcontainer(true);

    // devcontainer設定情報を保存
    const config = {
      useDevcontainer: true,
      hasDevcontainerFile: false, // fallbackを使用
      hasAnthropicsFeature: true, // fallbackにはClaude Codeが含まれている
      useFallback: true,
      isStarted: false,
    };
    await this.saveDevcontainerConfig(threadId, config);

    // fallback devcontainerを起動
    return "fallback_devcontainer_start_with_progress";
  }

  /**
   * スレッドのdevcontainer設定を保存する
   */
  async saveDevcontainerConfig(
    threadId: string,
    config: {
      useDevcontainer: boolean;
      hasDevcontainerFile: boolean;
      hasAnthropicsFeature: boolean;
      containerId?: string;
      isStarted: boolean;
      useFallback?: boolean;
    },
  ): Promise<void> {
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    if (workerState) {
      // 新しい構造に合わせて更新
      workerState.devcontainerConfig = {
        ...config,
        useFallbackDevcontainer: config.useFallback ||
          workerState.devcontainerConfig.useFallbackDevcontainer || false,
      };
      workerState.lastActiveAt = new Date().toISOString();
      await this.workspaceManager.saveWorkerState(workerState);
      this.logVerbose("devcontainer設定保存完了", { threadId, config });
    }
  }

  /**
   * スレッドのdevcontainer設定を取得する
   */
  async getDevcontainerConfig(threadId: string): Promise<
    {
      useDevcontainer: boolean;
      hasDevcontainerFile: boolean;
      hasAnthropicsFeature: boolean;
      containerId?: string;
      isStarted: boolean;
    } | null
  > {
    const workerState = await this.workspaceManager.loadWorkerState(threadId);
    return workerState?.devcontainerConfig || null;
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
      const logMessage = `[${timestamp}] [DevcontainerManager] ${message}`;
      console.log(logMessage);

      if (metadata && Object.keys(metadata).length > 0) {
        console.log(
          `[${timestamp}] [DevcontainerManager] メタデータ:`,
          metadata,
        );
      }
    }
  }
}
