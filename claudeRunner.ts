// Claude Code実行機能
// Claude Code の継続モードおよびプリントモードの実行ラッパー
// ストリーミング出力、プロンプトテンプレート、実行履歴、diff解析を提供

import { dirname, exists, join } from './deps.ts';

/**
 * Claude実行モード
 */
export enum ClaudeExecutionMode {
  /** 継続モード（インタラクティブ） */
  CONTINUOUS = 'continuous',
  /** プリントモード（単一実行） */
  PRINT = 'print',
}

/**
 * Claude実行オプション
 */
export interface ClaudeExecutionOptions {
  /** 実行モード */
  mode: ClaudeExecutionMode;
  /** プロンプト（プリントモード時） */
  prompt?: string;
  /** 作業ディレクトリ */
  workingDirectory: string;
  /** タイムアウト（秒） */
  timeout?: number;
  /** 環境変数 */
  environment?: Record<string, string>;
  /** ストリーミング出力のコールバック */
  onOutput?: (chunk: string, isError: boolean) => void;
  /** 進捗更新のコールバック */
  onProgress?: (progress: ClaudeProgress) => void;
}

/**
 * Claude実行結果
 */
export interface ClaudeExecutionResult {
  /** 成功フラグ */
  success: boolean;
  /** 標準出力 */
  stdout: string;
  /** エラー出力 */
  stderr: string;
  /** 終了コード */
  exitCode?: number;
  /** 実行時間（ミリ秒） */
  duration: number;
  /** 解析されたdiff情報 */
  diffs?: FileDiff[];
  /** 検出されたファイル操作 */
  fileOperations?: FileOperation[];
  /** 構文ハイライト済み出力 */
  highlightedOutput?: string;
}

/**
 * Claude実行進捗情報
 */
export interface ClaudeProgress {
  /** 進捗段階 */
  stage: 'starting' | 'analyzing' | 'generating' | 'applying' | 'completed';
  /** 進捗メッセージ */
  message: string;
  /** 進捗率（0-100） */
  percentage: number;
  /** 開始時刻 */
  startTime: Date;
  /** 経過時間（ミリ秒） */
  elapsedTime: number;
}

/**
 * ファイルdiff情報
 */
export interface FileDiff {
  /** ファイルパス */
  filePath: string;
  /** diff種別 */
  type: 'added' | 'modified' | 'deleted' | 'renamed';
  /** 追加行数 */
  linesAdded: number;
  /** 削除行数 */
  linesDeleted: number;
  /** diff内容 */
  content: string;
  /** 変更前のファイルパス（リネームの場合） */
  oldPath?: string;
}

/**
 * ファイル操作情報
 */
export interface FileOperation {
  /** 操作種別 */
  type: 'create' | 'delete' | 'modify' | 'rename' | 'move';
  /** ファイルパス */
  filePath: string;
  /** 操作前のパス（リネーム・移動の場合） */
  oldPath?: string;
  /** ファイルサイズ（バイト） */
  size?: number;
  /** 操作時刻 */
  timestamp: Date;
}

/**
 * プロンプトテンプレート
 */
export interface PromptTemplate {
  /** テンプレート名 */
  name: string;
  /** テンプレート説明 */
  description: string;
  /** プロンプト内容 */
  content: string;
  /** 変数定義 */
  variables?: Array<{
    name: string;
    description: string;
    defaultValue?: string;
    required: boolean;
  }>;
  /** カテゴリ */
  category?: string;
}

/**
 * 実行履歴エントリ
 */
export interface ExecutionHistoryEntry {
  /** 実行ID */
  id: string;
  /** 実行時刻 */
  timestamp: Date;
  /** 実行モード */
  mode: ClaudeExecutionMode;
  /** プロンプト */
  prompt: string;
  /** 作業ディレクトリ */
  workingDirectory: string;
  /** 実行結果 */
  result: ClaudeExecutionResult;
  /** ユーザーID（Discord） */
  userId?: string;
  /** セッションID */
  sessionId?: string;
}

/**
 * 出力バッファ
 */
class OutputBuffer {
  private buffer: string = '';
  private chunks: Array<{ content: string; timestamp: Date; isError: boolean }> = [];
  private maxChunks: number;

  constructor(maxChunks: number = 1000) {
    this.maxChunks = maxChunks;
  }

  /**
   * チャンクを追加
   */
  addChunk(content: string, isError: boolean = false): void {
    const chunk = {
      content,
      timestamp: new Date(),
      isError,
    };

    this.chunks.push(chunk);
    this.buffer += content;

    // 最大チャンク数を超えたら古いものを削除
    if (this.chunks.length > this.maxChunks) {
      const removedChunk = this.chunks.shift();
      if (removedChunk) {
        this.buffer = this.buffer.substring(removedChunk.content.length);
      }
    }
  }

  /**
   * バッファの内容を取得
   */
  getContent(): string {
    return this.buffer;
  }

  /**
   * チャンクリストを取得
   */
  getChunks(): Array<{ content: string; timestamp: Date; isError: boolean }> {
    return [...this.chunks];
  }

  /**
   * バッファをクリア
   */
  clear(): void {
    this.buffer = '';
    this.chunks = [];
  }

  /**
   * 最新のN行を取得
   */
  getLastLines(n: number): string {
    const lines = this.buffer.split('\n');
    return lines.slice(-n).join('\n');
  }
}

/**
 * Diff解析ユーティリティ
 */
export class DiffAnalyzer {
  /**
   * テキストからdiff情報を抽出
   */
  static parseDiffs(text: string): FileDiff[] {
    const diffs: FileDiff[] = [];
    const diffBlocks = text.split(/^diff --git/m);

    for (const block of diffBlocks) {
      if (!block.trim()) continue;

      const diff = this.parseDiffBlock('diff --git' + block);
      if (diff) {
        diffs.push(diff);
      }
    }

    return diffs;
  }

  /**
   * 単一のdiffブロックを解析
   */
  private static parseDiffBlock(block: string): FileDiff | null {
    const lines = block.split('\n');

    // ファイルパスを抽出
    const filePathMatch = lines[0]?.match(/diff --git a\/(.+) b\/(.+)/);
    if (!filePathMatch) return null;

    const oldPath = filePathMatch[1];
    const newPath = filePathMatch[2];
    const filePath = newPath || 'unknown';

    // diff種別を判定
    let type: FileDiff['type'] = 'modified';
    let linesAdded = 0;
    let linesDeleted = 0;

    // ファイル操作の種別を判定
    for (const line of lines) {
      if (line.startsWith('new file mode')) {
        type = 'added';
      } else if (line.startsWith('deleted file mode')) {
        type = 'deleted';
      } else if (oldPath !== newPath) {
        type = 'renamed';
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesDeleted++;
      }
    }

    return {
      filePath,
      type,
      linesAdded,
      linesDeleted,
      content: block,
      ...(type === 'renamed' && { oldPath }),
    };
  }

  /**
   * ファイル操作を検出
   */
  static detectFileOperations(text: string, workingDirectory: string): FileOperation[] {
    const operations: FileOperation[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      // Claude Codeの出力パターンを解析
      const createMatch = line.match(/Created file: (.+)/);
      const deleteMatch = line.match(/Deleted file: (.+)/);
      const modifyMatch = line.match(/Modified file: (.+)/);
      const renameMatch = line.match(/Renamed file: (.+) -> (.+)/);

      if (createMatch && createMatch[1]) {
        operations.push({
          type: 'create',
          filePath: join(workingDirectory, createMatch[1]),
          timestamp: new Date(),
        });
      } else if (deleteMatch && deleteMatch[1]) {
        operations.push({
          type: 'delete',
          filePath: join(workingDirectory, deleteMatch[1]),
          timestamp: new Date(),
        });
      } else if (modifyMatch && modifyMatch[1]) {
        operations.push({
          type: 'modify',
          filePath: join(workingDirectory, modifyMatch[1]),
          timestamp: new Date(),
        });
      } else if (renameMatch && renameMatch[1] && renameMatch[2]) {
        operations.push({
          type: 'rename',
          filePath: join(workingDirectory, renameMatch[2]),
          oldPath: join(workingDirectory, renameMatch[1]),
          timestamp: new Date(),
        });
      }
    }

    return operations;
  }
}

/**
 * 構文ハイライトユーティリティ
 */
export class SyntaxHighlighter {
  /**
   * Discord用の構文ハイライトを適用
   */
  static highlightForDiscord(text: string, language: string = 'typescript'): string {
    // Discord用のコードブロック形式
    return `\`\`\`${language}\n${text}\n\`\`\``;
  }

  /**
   * diff用の構文ハイライトを適用
   */
  static highlightDiff(diff: string): string {
    const lines = diff.split('\n');
    const highlightedLines = lines.map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `+ ${line.substring(1)}`; // 追加行
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `- ${line.substring(1)}`; // 削除行
      } else if (line.startsWith('@@')) {
        return `# ${line}`; // ハンク情報
      }
      return line;
    });

    return this.highlightForDiscord(highlightedLines.join('\n'), 'diff');
  }

  /**
   * ファイル操作の要約を生成
   */
  static summarizeFileOperations(operations: FileOperation[]): string {
    if (operations.length === 0) return 'ファイル操作はありません。';

    const summary = operations.reduce((acc, op) => {
      acc[op.type] = (acc[op.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const parts: string[] = [];
    if (summary['create']) parts.push(`作成: ${summary['create']}個`);
    if (summary['modify']) parts.push(`変更: ${summary['modify']}個`);
    if (summary['delete']) parts.push(`削除: ${summary['delete']}個`);
    if (summary['rename']) parts.push(`リネーム: ${summary['rename']}個`);

    return parts.join(', ');
  }
}

/**
 * プロンプトテンプレート管理
 */
export class PromptTemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();

  constructor(_templateDir: string = '~/.claude-bot/templates') {
    this.loadDefaultTemplates();
  }

  /**
   * デフォルトテンプレートを読み込み
   */
  private loadDefaultTemplates(): void {
    const defaultTemplates: PromptTemplate[] = [
      {
        name: 'bug-fix',
        description: 'バグ修正用のプロンプト',
        content: `以下のバグを修正してください:

問題の説明: {{description}}
再現手順: {{steps}}
期待する動作: {{expected}}
現在の動作: {{actual}}

ファイル: {{file}}`,
        variables: [
          { name: 'description', description: 'バグの説明', required: true },
          { name: 'steps', description: '再現手順', required: true },
          { name: 'expected', description: '期待する動作', required: true },
          { name: 'actual', description: '現在の動作', required: true },
          { name: 'file', description: '対象ファイル', required: false },
        ],
        category: 'development',
      },
      {
        name: 'feature-implementation',
        description: '新機能実装用のプロンプト',
        content: `以下の新機能を実装してください:

機能名: {{feature_name}}
要件: {{requirements}}
実装方針: {{approach}}

{{additional_context}}`,
        variables: [
          { name: 'feature_name', description: '機能名', required: true },
          { name: 'requirements', description: '要件', required: true },
          { name: 'approach', description: '実装方針', required: false },
          { name: 'additional_context', description: '追加のコンテキスト', required: false },
        ],
        category: 'development',
      },
      {
        name: 'code-review',
        description: 'コードレビュー用のプロンプト',
        content: `以下のコードをレビューしてください:

ファイル: {{file_path}}
変更内容: {{changes}}

レビュー観点:
- セキュリティ
- パフォーマンス
- 可読性
- 保守性
- テスト可能性

{{additional_notes}}`,
        variables: [
          { name: 'file_path', description: 'ファイルパス', required: true },
          { name: 'changes', description: '変更内容', required: true },
          { name: 'additional_notes', description: '追加の注意点', required: false },
        ],
        category: 'review',
      },
    ];

    for (const template of defaultTemplates) {
      this.templates.set(template.name, template);
    }
  }

  /**
   * テンプレートを取得
   */
  getTemplate(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * 全テンプレートを取得
   */
  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * カテゴリ別テンプレートを取得
   */
  getTemplatesByCategory(category: string): PromptTemplate[] {
    return this.getAllTemplates().filter((t) => t.category === category);
  }

  /**
   * テンプレートを展開
   */
  expandTemplate(templateName: string, variables: Record<string, string>): string {
    const template = this.getTemplate(templateName);
    if (!template) {
      throw new Error(`テンプレート '${templateName}' が見つかりません`);
    }

    let content = template.content;

    // 変数を置換
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      content = content.replace(new RegExp(placeholder, 'g'), value);
    }

    // 必須変数のチェック
    const requiredVars = template.variables?.filter((v) => v.required) || [];
    for (const variable of requiredVars) {
      if (!(variable.name in variables)) {
        throw new Error(`必須変数 '${variable.name}' が指定されていません`);
      }
    }

    return content;
  }
}

/**
 * 実行履歴管理
 */
export class ExecutionHistory {
  private history: ExecutionHistoryEntry[] = [];
  private maxEntries: number;
  private storageFile: string;

  constructor(maxEntries: number = 1000, storageFile: string = '~/.claude-bot/history.json') {
    this.maxEntries = maxEntries;
    this.storageFile = storageFile;
  }

  /**
   * 履歴エントリを追加
   */
  addEntry(entry: Omit<ExecutionHistoryEntry, 'id' | 'timestamp'>): string {
    const id = crypto.randomUUID();
    const fullEntry: ExecutionHistoryEntry = {
      ...entry,
      id,
      timestamp: new Date(),
    };

    this.history.push(fullEntry);

    // 最大エントリ数を超えたら古いものを削除
    if (this.history.length > this.maxEntries) {
      this.history.shift();
    }

    this.saveHistory();
    return id;
  }

  /**
   * 履歴を取得
   */
  getHistory(limit?: number): ExecutionHistoryEntry[] {
    const entries = [...this.history].reverse(); // 新しい順
    return limit ? entries.slice(0, limit) : entries;
  }

  /**
   * 特定のエントリを取得
   */
  getEntry(id: string): ExecutionHistoryEntry | undefined {
    return this.history.find((entry) => entry.id === id);
  }

  /**
   * ユーザー別履歴を取得
   */
  getHistoryByUser(userId: string, limit?: number): ExecutionHistoryEntry[] {
    const userEntries = this.history.filter((entry) => entry.userId === userId);
    const sortedEntries = userEntries.reverse(); // 新しい順
    return limit ? sortedEntries.slice(0, limit) : sortedEntries;
  }

  /**
   * 履歴を保存
   */
  private async saveHistory(): Promise<void> {
    try {
      const dir = dirname(this.storageFile);
      if (!(await exists(dir))) {
        await Deno.mkdir(dir, { recursive: true });
      }

      await Deno.writeTextFile(this.storageFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      console.error('履歴の保存に失敗:', error);
    }
  }

  /**
   * 履歴を読み込み
   */
  async loadHistory(): Promise<void> {
    try {
      if (await exists(this.storageFile)) {
        const content = await Deno.readTextFile(this.storageFile);
        this.history = JSON.parse(content);
      }
    } catch (error) {
      console.error('履歴の読み込みに失敗:', error);
      this.history = [];
    }
  }
}

/**
 * Claude実行エンジン
 */
export class ClaudeRunner {
  private outputBuffer: OutputBuffer;
  private templateManager: PromptTemplateManager;
  private executionHistory: ExecutionHistory;

  constructor(options: {
    maxBufferChunks?: number;
    templateDir?: string;
    maxHistoryEntries?: number;
    historyFile?: string;
  } = {}) {
    this.outputBuffer = new OutputBuffer(options.maxBufferChunks);
    this.templateManager = new PromptTemplateManager(options.templateDir);
    this.executionHistory = new ExecutionHistory(options.maxHistoryEntries, options.historyFile);
  }

  /**
   * Claudeを実行
   */
  async execute(options: ClaudeExecutionOptions): Promise<ClaudeExecutionResult> {
    const startTime = Date.now();
    let stdout = '';

    try {
      // 進捗通知
      options.onProgress?.({
        stage: 'starting',
        message: 'Claude Codeを開始しています...',
        percentage: 0,
        startTime: new Date(),
        elapsedTime: 0,
      });

      // コマンドライン引数を構築
      const args = ['claude'];

      if (options.mode === ClaudeExecutionMode.PRINT && options.prompt) {
        args.push('-p', options.prompt);
      } else if (options.mode === ClaudeExecutionMode.CONTINUOUS) {
        args.push('-c');
      }

      // バッファをクリア
      this.outputBuffer.clear();

      // Claudeコマンドを実行
      const commandName = args[0];
      if (!commandName) {
        throw new Error('コマンド名が指定されていません');
      }

      const command = new Deno.Command(commandName, {
        args: args.slice(1),
        cwd: options.workingDirectory,
        stdout: 'piped',
        stderr: 'piped',
        env: {
          ...Deno.env.toObject(),
          ...options.environment,
        },
      });

      // タイムアウト設定
      const timeout = (options.timeout || 600) * 1000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Claude実行がタイムアウトしました (${options.timeout || 600}秒)`));
        }, timeout);
      });

      // ストリーミング実行
      const executePromise = this.executeWithStreaming(command, options);

      const result = await Promise.race([executePromise, timeoutPromise]);

      const duration = Date.now() - startTime;

      // 出力を取得
      stdout = this.outputBuffer.getContent();

      // diff解析
      const diffs = DiffAnalyzer.parseDiffs(stdout);

      // ファイル操作検出
      const fileOperations = DiffAnalyzer.detectFileOperations(stdout, options.workingDirectory);

      // 構文ハイライト
      const highlightedOutput = SyntaxHighlighter.highlightForDiscord(stdout);

      const executionResult: ClaudeExecutionResult = {
        success: result.success,
        stdout,
        stderr: result.stderr || '',
        ...(result.exitCode !== undefined && { exitCode: result.exitCode }),
        duration,
        diffs,
        fileOperations,
        highlightedOutput,
      };

      // 履歴に追加
      this.executionHistory.addEntry({
        mode: options.mode,
        prompt: options.prompt || '',
        workingDirectory: options.workingDirectory,
        result: executionResult,
      });

      // 進捗通知
      options.onProgress?.({
        stage: 'completed',
        message: 'Claude Code実行が完了しました',
        percentage: 100,
        startTime: new Date(startTime),
        elapsedTime: duration,
      });

      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;

      const executionResult: ClaudeExecutionResult = {
        success: false,
        stdout: this.outputBuffer.getContent(),
        stderr: error instanceof Error ? error.message : String(error),
        duration,
      };

      return executionResult;
    }
  }

  /**
   * ストリーミング付きで実行
   */
  private async executeWithStreaming(
    command: Deno.Command,
    options: ClaudeExecutionOptions,
  ): Promise<{ success: boolean; stderr?: string; exitCode?: number }> {
    const child = command.spawn();

    let stderr = '';

    // 標準出力のストリーミング処理
    if (child.stdout) {
      const stdoutReader = child.stdout.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          this.outputBuffer.addChunk(chunk, false);
          options.onOutput?.(chunk, false);
        }
      } finally {
        stdoutReader.releaseLock();
      }
    }

    // 標準エラー出力の処理
    if (child.stderr) {
      const stderrReader = child.stderr.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          stderr += chunk;
          this.outputBuffer.addChunk(chunk, true);
          options.onOutput?.(chunk, true);
        }
      } finally {
        stderrReader.releaseLock();
      }
    }

    const status = await child.status;

    return {
      success: status.success,
      stderr,
      exitCode: status.code,
    };
  }

  /**
   * テンプレートマネージャーを取得
   */
  getTemplateManager(): PromptTemplateManager {
    return this.templateManager;
  }

  /**
   * 実行履歴を取得
   */
  getExecutionHistory(): ExecutionHistory {
    return this.executionHistory;
  }

  /**
   * 出力バッファを取得
   */
  getOutputBuffer(): string {
    return this.outputBuffer.getContent();
  }

  /**
   * 出力バッファの最新N行を取得
   */
  getLatestOutput(lines: number = 10): string {
    return this.outputBuffer.getLastLines(lines);
  }

  /**
   * 履歴を初期化
   */
  async initialize(): Promise<void> {
    await this.executionHistory.loadHistory();
  }
}
