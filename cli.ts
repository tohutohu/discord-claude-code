#!/usr/bin/env -S deno run -A

/**
 * Discord Claude Code CLI エントリーポイント
 */

import { Command, CompletionsCommand, green, HelpCommand, red, yellow } from './deps.ts';
import { generateSampleConfig, loadConfig } from './config.ts';

const VERSION = '0.1.0-dev';

// メインコマンドの定義
const cli = new Command()
  .name('claude-bot')
  .version(VERSION)
  .description('Discord から Claude Code を並列操作するツール')
  .globalOption('-c, --config <path:string>', '設定ファイルのパス', {
    default: './claude-bot.yaml',
  })
  .globalOption('-v, --verbose', '詳細なログを出力（DEBUG レベル）')
  .globalOption('-q, --quiet', 'エラーのみを出力（ERROR レベル）');

// runサブコマンド（デフォルト）
cli.command('run')
  .description('TUI を起動してボットを実行（デフォルト）')
  .action(async (options) => {
    console.log(green('🚀 TUI を起動しています...'));
    console.log(yellow('⚠️  TUI 実装は PR-2.4 で完成予定です'));

    // 設定ファイルの読み込み
    try {
      const config = await loadConfig(options.config);
      console.log(green('✅ 設定ファイルを読み込みました'));
      console.log(`📁 リポジトリルート: ${config.rootDir}`);
      console.log(`🔄 最大セッション数: ${config.parallel.maxSessions}`);
      console.log(`📝 ログレベル: ${config.logging.level}`);
    } catch (error) {
      console.error(red('❌ 設定ファイルの読み込みに失敗しました:'));
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }
  });

// listサブコマンド
cli.command('list')
  .description('アクティブなセッションの一覧を表示')
  .option('-j, --json', 'JSON 形式で出力')
  .action((options) => {
    if (options.json) {
      console.log(JSON.stringify(
        {
          sessions: [],
          message: 'セッション管理は PR-4 で実装予定',
        },
        null,
        2,
      ));
    } else {
      console.log(yellow('📋 アクティブなセッション'));
      console.log(yellow('セッション管理機能は PR-4 で実装予定です'));
    }
  });

// endサブコマンド
cli.command('end <thread-id:string>')
  .description('指定したスレッドのセッションを終了')
  .action((_, threadId) => {
    console.log(yellow(`🛑 セッション ${threadId} を終了しています...`));
    console.log(yellow('セッション管理機能は PR-4 で実装予定です'));
  });

// cleanサブコマンド
cli.command('clean')
  .description('終了済みセッションと worktree を削除')
  .option('-f, --force', '確認なしで削除')
  .action((options) => {
    if (!options.force) {
      console.log(yellow('⚠️  終了済みセッションと worktree を削除します。'));
      console.log(yellow('実行するには --force オプションを指定してください。'));
    } else {
      console.log(yellow('🧹 クリーンアップ中...'));
      console.log(yellow('セッション管理機能は PR-4 で実装予定です'));
    }
  });

// init-configサブコマンド
cli.command('init-config [path:string]')
  .description('サンプル設定ファイルを生成')
  .action(async (_, path = './claude-bot.example.yaml') => {
    try {
      await generateSampleConfig(path);
      console.log(green(`✅ サンプル設定ファイルを生成しました: ${path}`));
      console.log('設定を編集して、ボットを起動してください。');
    } catch (error) {
      console.error(red('❌ 設定ファイルの生成に失敗しました:'));
      console.error(error instanceof Error ? error.message : String(error));
      Deno.exit(1);
    }
  });

// versionサブコマンド
cli.command('version')
  .description('バージョン情報を表示')
  .action(() => {
    console.log(`Claude Bot v${VERSION}`);
    console.log(`Deno ${Deno.version.deno}`);
    console.log(`V8 ${Deno.version.v8}`);
    console.log(`TypeScript ${Deno.version.typescript}`);
  });

// 補完とヘルプを追加
cli.command('completions', new CompletionsCommand());
cli.command('help', new HelpCommand().global());

// CLIを実行
if (import.meta.main) {
  // 引数がない場合はrunを実行
  const args = Deno.args.length === 0 ? ['run'] : Deno.args;
  await cli.parse(args);
}
