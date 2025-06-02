#!/usr/bin/env -S deno run -A

/**
 * CLIエントリポイント
 * サブコマンドの定義と実行
 */

import { colors, Command } from './deps.ts';
import { loadConfig, validateConfig } from './config.ts';
import { logger } from './logger.ts';

const VERSION = '0.1.0';

/**
 * メインコマンドを作成する
 */
export function createMainCommand(): Command {
  return new Command()
    .name('discord-claude-code')
    .version(VERSION)
    .description('Discord から Claude Code を並列操作するツール')
    .globalOption('-c, --config <path:string>', '設定ファイルのパス')
    .globalOption('-v, --verbose', 'デバッグログを出力', {
      action: () => logger.setLevel('DEBUG'),
    })
    .globalOption('-q, --quiet', 'エラーログのみ出力', {
      action: () => logger.setLevel('ERROR'),
    });
}

/**
 * runコマンド（デフォルト）
 */
const runCommand = new Command()
  .description('TUIを起動してボットを実行（デフォルト）')
  .action(async (options) => {
    const globalOptions = runCommand.getGlobalOptions();
    const config = await loadConfig(globalOptions.config);
    validateConfig(config);

    logger.info('Claude Bot を起動しています...', { version: VERSION });

    // TUIアプリケーションの起動
    const { TuiApp } = await import('./tui/app.ts');
    const app = new TuiApp(config);
    app.init();
    app.run();
  });

/**
 * listコマンド
 */
const listCommand = new Command()
  .description('アクティブなセッション一覧を表示')
  .option('-j, --json', 'JSON形式で出力')
  .action(async (options) => {
    const globalOptions = listCommand.getGlobalOptions();
    const config = await loadConfig(globalOptions.config);

    logger.debug('セッション一覧を取得中...');

    // TODO(@cli): セッション一覧の取得
    const sessions = [
      { id: '123', repository: 'core-api', status: 'running' },
      { id: '456', repository: 'web-admin', status: 'waiting' },
    ];

    if (options.json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      console.log(colors.bold('アクティブなセッション:'));
      sessions.forEach((session) => {
        const statusIcon = session.status === 'running' ? '🟢' : '⏸️';
        console.log(`${statusIcon} [${session.id}] ${session.repository}`);
      });
    }
  });

/**
 * endコマンド
 */
const endCommand = new Command()
  .description('指定したセッションを終了')
  .arguments('<thread-id:string>')
  .action(async (options, threadId) => {
    const globalOptions = endCommand.getGlobalOptions();
    const config = await loadConfig(globalOptions.config);

    logger.info(`セッションを終了: ${threadId}`);

    // TODO(@cli): セッション終了処理
    console.log(colors.yellow(`⚠️ セッション ${threadId} を終了しました（未実装）`));
  });

/**
 * cleanコマンド
 */
const cleanCommand = new Command()
  .description('終了済みセッションとworktreeを削除')
  .option('-f, --force', '確認なしで削除')
  .action(async (options) => {
    const globalOptions = cleanCommand.getGlobalOptions();
    const config = await loadConfig(globalOptions.config);

    logger.info('クリーンアップを実行中...');

    // TODO(@cli): クリーンアップ処理
    console.log(colors.green('✅ クリーンアップ完了（未実装）'));
  });

/**
 * versionコマンド
 */
const versionCommand = new Command()
  .description('バージョン情報を表示')
  .action(() => {
    console.log(`discord-claude-code v${VERSION}`);
    console.log(`Deno ${Deno.version.deno}`);
    console.log(`V8 ${Deno.version.v8}`);
    console.log(`TypeScript ${Deno.version.typescript}`);
  });

/**
 * メイン関数
 */
async function main() {
  try {
    // ロガーを初期化
    await logger.init();

    // シグナルハンドラを設定
    Deno.addSignalListener('SIGINT', async () => {
      logger.info('シャットダウン中...');
      await logger.cleanup();
      Deno.exit(0);
    });

    // コマンドを構築
    const cli = createMainCommand()
      .command('run', runCommand)
      .command('list', listCommand)
      .command('end', endCommand)
      .command('clean', cleanCommand)
      .command('version', versionCommand)
      .default('run'); // デフォルトはrunコマンド

    // コマンドを実行
    await cli.parse(Deno.args);
  } catch (error) {
    logger.fatal('致命的なエラーが発生しました', { error: error.message });
    console.error(error);
    Deno.exit(1);
  }
}

// エントリポイント
if (import.meta.main) {
  await main();
}
