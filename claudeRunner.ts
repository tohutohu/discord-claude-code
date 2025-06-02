/**
 * Claude Code CLI のラッパー実装
 * @cli Claude Code実行の統合管理
 */

import { DevContainerManager } from './devcontainer.ts';
import { logger } from './logger.ts';
import { Config } from './types/config.ts';

/** Claude実行モード */
export enum ClaudeMode {
  /** 継続モード（インタラクティブ） */
  CONTINUOUS = 'continuous',
  /** プロンプトモード（単一実行） */
  PROMPT = 'prompt',
}

/** Claude実行オプション */
export interface ClaudeRunOptions {
  /** 実行モード */
  mode: ClaudeMode;
  /** プロンプト（プロンプトモード時） */
  prompt?: string;
  /** ワークスペースフォルダ */
  workspaceFolder: string;
  /** 環境変数 */
  env?: Record<string, string>;
  /** タイムアウト（秒） */
  timeout?: number;
  /** ストリーミング出力のコールバック */
  onOutput?: (chunk: string, isError: boolean) => void;
  /** 進捗コールバック */
  onProgress?: (progress: ClaudeProgress) => void;
}

/** Claude実行結果 */
export interface ClaudeResult {
  /** 成功かどうか */
  success: boolean;
  /** 完全な出力 */
  fullOutput: string;
  /** エラー出力 */
  errorOutput: string;
  /** 終了コード */
  exitCode: number;
  /** 実行時間（秒） */
  duration: number;
  /** パースされた変更 */
  changes: FileChange[];
  /** 生成されたdiff */
  diffs: DiffBlock[];
}

/** ファイル変更情報 */
export interface FileChange {
  /** ファイルパス */
  path: string;
  /** 変更タイプ */
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  /** 追加行数 */
  linesAdded: number;
  /** 削除行数 */
  linesDeleted: number;
  /** 旧ファイル名（リネーム時） */
  oldPath?: string;
}

/** Diffブロック */
export interface DiffBlock {
  /** ファイルパス */
  filePath: string;
  /** diff内容 */
  content: string;
  /** ハイライト済みコンテンツ（Discord用） */
  highlighted: string;
}

/** Claude実行進捗 */
export interface ClaudeProgress {
  /** 段階 */
  stage: 'starting' | 'thinking' | 'generating' | 'finalizing';
  /** 進捗率（0-100） */
  percentage: number;
  /** 現在の作業内容 */
  message: string;
  /** 経過時間（秒） */
  elapsed: number;
}

/** プロンプトテンプレート */
export interface PromptTemplate {
  /** テンプレート名 */
  name: string;
  /** テンプレート内容 */
  template: string;
  /** 変数定義 */
  variables: PromptVariable[];
  /** 説明 */
  description?: string;
}

/** プロンプト変数 */
export interface PromptVariable {
  /** 変数名 */
  name: string;
  /** 説明 */
  description: string;
  /** デフォルト値 */
  defaultValue?: string;
  /** 必須かどうか */
  required: boolean;
}

/** 実行履歴エントリ */
export interface ExecutionHistory {
  /** 実行ID */
  id: string;
  /** 実行時刻 */
  timestamp: Date;
  /** ワークスペース */
  workspace: string;
  /** プロンプト */
  prompt: string;
  /** 結果 */
  result: ClaudeResult;
  /** 使用したテンプレート */
  template?: string;
}

/** Claudeランナー例外 */
export class ClaudeRunnerError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly output: string,
  ) {
    super(message);
    this.name = 'ClaudeRunnerError';
  }
}

/**
 * Claude Code実行管理クラス
 * Claude Code CLIのラッパーとして動作し、実行管理と出力解析を行う
 */
export class ClaudeRunner {
  private config: Config;
  private devcontainer: DevContainerManager;
  private templates = new Map<string, PromptTemplate>();
  private history: ExecutionHistory[] = [];
  private maxHistorySize = 100;

  constructor(config: Config, devcontainer: DevContainerManager) {
    this.config = config;
    this.devcontainer = devcontainer;
    this.loadBuiltinTemplates();
  }

  /**
   * Claude Codeを実行
   * @param options 実行オプション
   * @returns 実行結果
   */
  async run(options: ClaudeRunOptions): Promise<ClaudeResult> {
    const startTime = Date.now();
    const executionId = crypto.randomUUID();

    logger.info(`Claude実行開始: ${options.mode}`, {
      executionId,
      mode: options.mode,
      workspace: options.workspaceFolder,
    });

    try {
      // 進捗通知
      options.onProgress?.({
        stage: 'starting',
        percentage: 0,
        message: 'Claude Code を起動中...',
        elapsed: 0,
      });

      // Claude Codeコマンドを構築
      const command = this.buildClaudeCommand(options);

      // 出力バッファー
      let fullOutput = '';
      let errorOutput = '';

      // 進捗追跡用
      let lastProgressUpdate = Date.now();

      // ストリーミング実行
      const result = await this.executeWithStreaming(
        options.workspaceFolder,
        command,
        options.timeout || this.config.claude.timeout,
        (chunk, isError) => {
          if (isError) {
            errorOutput += chunk;
          } else {
            fullOutput += chunk;
          }

          // 出力コールバック
          options.onOutput?.(chunk, isError);

          // 進捗推定
          const now = Date.now();
          if (now - lastProgressUpdate > 2000) {
            // 2秒ごとに進捗更新
            const elapsed = (now - startTime) / 1000;
            const progress = this.estimateProgress(fullOutput, elapsed);
            options.onProgress?.(progress);
            lastProgressUpdate = now;
          }
        },
      );

      const duration = (Date.now() - startTime) / 1000;

      // 進捗完了通知
      options.onProgress?.({
        stage: 'finalizing',
        percentage: 100,
        message: '結果を解析中...',
        elapsed: duration,
      });

      // 出力を解析
      const changes = this.parseFileChanges(fullOutput);
      const diffs = this.parseDiffs(fullOutput);

      const claudeResult: ClaudeResult = {
        success: result.exitCode === 0,
        fullOutput,
        errorOutput,
        exitCode: result.exitCode,
        duration,
        changes,
        diffs,
      };

      // 履歴に保存
      this.saveToHistory({
        id: executionId,
        timestamp: new Date(),
        workspace: options.workspaceFolder,
        prompt: options.prompt || '[継続モード]',
        result: claudeResult,
      });

      logger.info(`Claude実行完了: ${result.exitCode}`, {
        executionId,
        exitCode: result.exitCode,
        duration,
        changesCount: changes.length,
        diffsCount: diffs.length,
      });

      return claudeResult;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      logger.error(`Claude実行エラー: ${error}`, {
        executionId,
        error,
        duration,
      });

      throw new ClaudeRunnerError(
        `Claude実行失敗: ${error.message}`,
        -1,
        error.message,
      );
    }
  }

  /**
   * プロンプトテンプレートを登録
   * @param template テンプレート
   */
  addTemplate(template: PromptTemplate): void {
    this.templates.set(template.name, template);
    logger.debug(`テンプレート登録: ${template.name}`);
  }

  /**
   * テンプレートを使用してプロンプトを生成
   * @param templateName テンプレート名
   * @param variables 変数値
   * @returns 生成されたプロンプト
   */
  renderTemplate(templateName: string, variables: Record<string, string>): string {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`テンプレートが見つかりません: ${templateName}`);
    }

    // 必須変数チェック
    for (const variable of template.variables) {
      if (variable.required && !variables[variable.name] && !variable.defaultValue) {
        throw new Error(`必須変数が指定されていません: ${variable.name}`);
      }
    }

    // テンプレートをレンダリング
    let rendered = template.template;
    for (const variable of template.variables) {
      const value = variables[variable.name] || variable.defaultValue || '';
      rendered = rendered.replace(new RegExp(`{{${variable.name}}}`, 'g'), value);
    }

    return rendered;
  }

  /**
   * 利用可能なテンプレート一覧を取得
   * @returns テンプレート一覧
   */
  getTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 実行履歴を取得
   * @param limit 取得件数（デフォルト10）
   * @returns 実行履歴
   */
  getHistory(limit = 10): ExecutionHistory[] {
    return this.history
      .slice(-limit)
      .reverse(); // 新しい順
  }

  /**
   * 履歴をクリア
   */
  clearHistory(): void {
    this.history.length = 0;
    logger.info('実行履歴をクリアしました');
  }

  /**
   * Claudeコマンドを構築
   * @param options 実行オプション
   * @returns コマンド文字列
   */
  private buildClaudeCommand(options: ClaudeRunOptions): string {
    const env = options.env || {};

    // 環境変数設定
    const envVars = [
      `ANTHROPIC_API_KEY=${Deno.env.get('ANTHROPIC_API_KEY') || ''}`,
      `TZ=Asia/Tokyo`,
      ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    ].join(' ');

    // Claudeコマンド構築
    let claudeCmd: string;
    if (options.mode === ClaudeMode.CONTINUOUS) {
      claudeCmd = 'claude -c';
    } else {
      const escapedPrompt = options.prompt?.replace(/'/g, "'\"'\"'") || '';
      claudeCmd = `claude -p '${escapedPrompt}'`;
    }

    return `cd /workspace && ${envVars} ${claudeCmd}`;
  }

  /**
   * ストリーミング実行
   * @param workspaceFolder ワークスペース
   * @param command コマンド
   * @param timeout タイムアウト
   * @param onOutput 出力コールバック
   * @returns 実行結果
   */
  private async executeWithStreaming(
    workspaceFolder: string,
    command: string,
    timeout: number,
    onOutput: (chunk: string, isError: boolean) => void,
  ): Promise<{ exitCode: number }> {
    // Dev Container内で実行
    const result = await this.devcontainer.exec(workspaceFolder, command, timeout);

    // 出力を通知（実際のストリーミングは簡略化）
    if (result.stdout) {
      onOutput(result.stdout, false);
    }
    if (result.stderr) {
      onOutput(result.stderr, true);
    }

    return { exitCode: result.exitCode };
  }

  /**
   * 進捗を推定
   * @param output 現在の出力
   * @param elapsed 経過時間
   * @returns 進捗情報
   */
  private estimateProgress(output: string, elapsed: number): ClaudeProgress {
    // 出力内容から段階を推定
    let stage: ClaudeProgress['stage'] = 'thinking';
    let percentage = 10;
    let message = 'Claude が思考中...';

    if (output.includes('Editing') || output.includes('Creating')) {
      stage = 'generating';
      percentage = 50;
      message = 'コードを生成中...';
    } else if (output.includes('Done') || output.includes('Complete')) {
      stage = 'finalizing';
      percentage = 90;
      message = '処理を完了中...';
    } else if (elapsed > 30) {
      // 30秒経過したら生成段階と推定
      stage = 'generating';
      percentage = Math.min(30 + elapsed * 2, 90);
      message = 'コードを生成中...';
    }

    return { stage, percentage, message, elapsed };
  }

  /**
   * ファイル変更を解析
   * @param output Claude出力
   * @returns ファイル変更リスト
   */
  private parseFileChanges(output: string): FileChange[] {
    const changes: FileChange[] = [];

    // 作成されたファイルを検出
    const createdMatches = output.matchAll(/Created:\s+(.+)/g);
    for (const match of createdMatches) {
      changes.push({
        path: match[1].trim(),
        type: 'created',
        linesAdded: this.countLinesInFile(output, match[1]),
        linesDeleted: 0,
      });
    }

    // 変更されたファイルを検出
    const modifiedMatches = output.matchAll(/Modified:\s+(.+)/g);
    for (const match of modifiedMatches) {
      const stats = this.parseFileStats(output, match[1]);
      changes.push({
        path: match[1].trim(),
        type: 'modified',
        linesAdded: stats.added,
        linesDeleted: stats.deleted,
      });
    }

    // 削除されたファイルを検出
    const deletedMatches = output.matchAll(/Deleted:\s+(.+)/g);
    for (const match of deletedMatches) {
      changes.push({
        path: match[1].trim(),
        type: 'deleted',
        linesAdded: 0,
        linesDeleted: this.countLinesInFile(output, match[1]),
      });
    }

    return changes;
  }

  /**
   * Diffブロックを解析
   * @param output Claude出力
   * @returns Diffブロックリスト
   */
  private parseDiffs(output: string): DiffBlock[] {
    const diffs: DiffBlock[] = [];

    // diff --git パターンを検出
    const diffPattern = /diff --git a\/(.+?) b\/(.+?)\n((?:.*\n)*?)(?=diff --git|$)/g;
    let match;

    while ((match = diffPattern.exec(output)) !== null) {
      const filePath = match[1];
      const diffContent = match[3];

      diffs.push({
        filePath,
        content: diffContent,
        highlighted: this.highlightDiff(diffContent),
      });
    }

    return diffs;
  }

  /**
   * Diffをハイライト（Discord用）
   * @param diff Diff内容
   * @returns ハイライト済みDiff
   */
  private highlightDiff(diff: string): string {
    const lines = diff.split('\n');
    const highlighted = lines.map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `+ ${line.slice(1)}`; // 追加行
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `- ${line.slice(1)}`; // 削除行
      } else if (line.startsWith('@@')) {
        return `> ${line}`; // ヘッダー
      }
      return line;
    });

    return `\`\`\`diff\n${highlighted.join('\n')}\n\`\`\``;
  }

  /**
   * ファイルの行数をカウント
   * @param output 出力
   * @param filePath ファイルパス
   * @returns 行数
   */
  private countLinesInFile(output: string, filePath: string): number {
    // 簡易実装：ファイル内容から行数推定
    const filePattern = new RegExp(`${filePath}.*?\n((?:.*\n)*?)(?=\\n[A-Za-z]|$)`, 'g');
    const match = filePattern.exec(output);
    return match ? match[1].split('\n').length : 0;
  }

  /**
   * ファイル統計を解析
   * @param output 出力
   * @param filePath ファイルパス
   * @returns 追加・削除行数
   */
  private parseFileStats(output: string, filePath: string): { added: number; deleted: number } {
    // git diff風の統計を探す
    const statsPattern = new RegExp(`${filePath}.*?\\+(\\d+).*?-(\\d+)`, 'g');
    const match = statsPattern.exec(output);

    return {
      added: match ? parseInt(match[1]) : 0,
      deleted: match ? parseInt(match[2]) : 0,
    };
  }

  /**
   * 履歴に保存
   * @param entry 履歴エントリ
   */
  private saveToHistory(entry: ExecutionHistory): void {
    this.history.push(entry);

    // 最大サイズを超えた場合は古いものを削除
    if (this.history.length > this.maxHistorySize) {
      this.history.splice(0, this.history.length - this.maxHistorySize);
    }
  }

  /**
   * 組み込みテンプレートを読み込み
   */
  private loadBuiltinTemplates(): void {
    // バグ修正テンプレート
    this.addTemplate({
      name: 'bug-fix',
      template: `以下のバグを修正してください：

問題の説明: {{description}}
再現手順: {{steps}}
期待する動作: {{expected}}

{{#if context}}
追加コンテキスト:
{{context}}
{{/if}}`,
      variables: [
        { name: 'description', description: 'バグの説明', required: true },
        { name: 'steps', description: '再現手順', required: true },
        { name: 'expected', description: '期待する動作', required: true },
        { name: 'context', description: '追加コンテキスト', required: false },
      ],
      description: 'バグ修正用のテンプレート',
    });

    // 新機能追加テンプレート
    this.addTemplate({
      name: 'feature-request',
      template: `以下の新機能を実装してください：

機能名: {{feature_name}}
説明: {{description}}
要件: {{requirements}}

{{#if examples}}
実装例:
{{examples}}
{{/if}}`,
      variables: [
        { name: 'feature_name', description: '機能名', required: true },
        { name: 'description', description: '機能の説明', required: true },
        { name: 'requirements', description: '要件', required: true },
        { name: 'examples', description: '実装例', required: false },
      ],
      description: '新機能実装用のテンプレート',
    });

    // リファクタリングテンプレート
    this.addTemplate({
      name: 'refactor',
      template: `以下のコードをリファクタリングしてください：

対象ファイル: {{target_files}}
目的: {{purpose}}
制約: {{constraints}}

{{#if guidelines}}
ガイドライン:
{{guidelines}}
{{/if}}`,
      variables: [
        { name: 'target_files', description: '対象ファイル', required: true },
        { name: 'purpose', description: 'リファクタリングの目的', required: true },
        {
          name: 'constraints',
          description: '制約事項',
          required: false,
          defaultValue: '既存の動作を変更しない',
        },
        { name: 'guidelines', description: 'ガイドライン', required: false },
      ],
      description: 'コードリファクタリング用のテンプレート',
    });

    logger.info(`組み込みテンプレート読み込み完了: ${this.templates.size}件`);
  }
}

// テスト @claude-runner
Deno.test('ClaudeRunner - テンプレートレンダリング', () => {
  const config = { claude: { timeout: 60 } } as Config;
  const devcontainer = {} as DevContainerManager;
  const runner = new ClaudeRunner(config, devcontainer);

  const rendered = runner.renderTemplate('bug-fix', {
    description: 'ログイン失敗',
    steps: '1. ページを開く 2. ログインする',
    expected: 'ログインできる',
  });

  assertEquals(rendered.includes('ログイン失敗'), true);
  assertEquals(rendered.includes('1. ページを開く'), true);
});

Deno.test('ClaudeRunner - ファイル変更解析', () => {
  const config = { claude: { timeout: 60 } } as Config;
  const devcontainer = {} as DevContainerManager;
  const runner = new ClaudeRunner(config, devcontainer);

  const output = `
Created: src/new-file.ts
Modified: src/existing-file.ts
Deleted: src/old-file.ts
  `;

  // Private method access for testing
  const changes = (runner as unknown as { parseFileChanges(output: string): FileChange[] })
    .parseFileChanges(output);
  assertEquals(changes.length, 3);
  assertEquals(changes[0].type, 'created');
  assertEquals(changes[1].type, 'modified');
  assertEquals(changes[2].type, 'deleted');
});

Deno.test('ClaudeRunner - Diffハイライト', () => {
  const config = { claude: { timeout: 60 } } as Config;
  const devcontainer = {} as DevContainerManager;
  const runner = new ClaudeRunner(config, devcontainer);

  const diff = `
@@ -1,3 +1,4 @@
 function test() {
+  console.log('new line');
   return true;
 }
  `;

  // Private method access for testing
  const highlighted = (runner as unknown as { highlightDiff(diff: string): string }).highlightDiff(
    diff,
  );
  assertEquals(highlighted.includes('```diff'), true);
  assertEquals(highlighted.includes('+ console.log'), true);
});

Deno.test('ClaudeRunner - 進捗推定', () => {
  const config = { claude: { timeout: 60 } } as Config;
  const devcontainer = {} as DevContainerManager;
  const runner = new ClaudeRunner(config, devcontainer);

  // Private method access for testing
  const privateRunner = runner as unknown as {
    estimateProgress(output: string, elapsed: number): ClaudeProgress;
  };

  const progress1 = privateRunner.estimateProgress('', 5);
  assertEquals(progress1.stage, 'thinking');

  const progress2 = privateRunner.estimateProgress('Creating file...', 15);
  assertEquals(progress2.stage, 'generating');

  const progress3 = privateRunner.estimateProgress('Done', 30);
  assertEquals(progress3.stage, 'finalizing');
});
