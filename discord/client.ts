/**
 * Discord クライアントの初期化と管理
 */

import { assertEquals, assertExists, discord } from '../deps.ts';
import { logger } from '../logger.ts';
import { Config } from '../types/config.ts';
import { CommandHandler, CommandMetadata } from '../types/discord.ts';
import { setupInteractions } from './interactions.ts';
import { startCommand } from './commands/start.ts';
import { listCommand } from './commands/list.ts';
import { configCommand } from './commands/config.ts';

/** コマンドレジストリ */
const commands = new Map<string, {
  metadata: CommandMetadata;
  handler: CommandHandler;
}>();

/**
 * コマンドを登録する
 * @param metadata コマンドメタデータ
 * @param handler コマンドハンドラ
 */
export function registerCommand(
  metadata: CommandMetadata,
  handler: CommandHandler,
): void {
  commands.set(metadata.name, { metadata, handler });
}

/**
 * Discord Botを作成する
 * @param config 設定
 * @returns Botインスタンス
 */
export async function createBot(config: Config): Promise<discord.Bot> {
  const token = Deno.env.get('DISCORD_TOKEN');
  if (!token) {
    throw new Error('DISCORD_TOKEN環境変数が設定されていません');
  }

  const applicationId = Deno.env.get('DISCORD_APPLICATION_ID');
  if (!applicationId) {
    throw new Error('DISCORD_APPLICATION_ID環境変数が設定されていません');
  }

  // ボットを作成
  const bot = discord.createBot({
    token,
    intents: discord.Intents.Guilds |
      discord.Intents.GuildMessages |
      discord.Intents.MessageContent,
    events: {
      ready: (_bot, payload) => {
        logger.info(`Discord Bot が起動しました: ${payload.user.username}`);
      },
      interactionCreate: async (bot, interaction) => {
        try {
          // スラッシュコマンド
          if (interaction.type === discord.InteractionTypes.ApplicationCommand) {
            const commandName = interaction.data?.name;
            if (commandName) {
              const command = commands.get(commandName);
              if (command) {
                await command.handler(interaction, bot);
              } else {
                logger.warn(`未知のコマンド: ${commandName}`);
              }
            }
          } // その他のインタラクション（ボタン、モーダルなど）
          else {
            await handleInteraction(interaction, bot);
          }
        } catch (error) {
          logger.error('インタラクション処理エラー:', { error: error.message });
          await respondWithError(interaction, bot);
        }
      },
    },
  });

  // コマンドを登録
  registerCommands();

  // スラッシュコマンドを同期
  await syncCommands(bot, applicationId, config.discord.guildIds);

  // インタラクションハンドラをセットアップ
  setupInteractions(bot);

  return bot;
}

/**
 * コマンドを登録する
 */
function registerCommands(): void {
  // /claude start コマンド
  registerCommand(startCommand.metadata, startCommand.handler);

  // /claude list コマンド
  registerCommand(listCommand.metadata, listCommand.handler);

  // /claude config コマンド
  registerCommand(configCommand.metadata, configCommand.handler);
}

/**
 * スラッシュコマンドを同期する
 * @param bot Botインスタンス
 * @param applicationId アプリケーションID
 * @param guildIds ギルドIDリスト
 */
async function syncCommands(
  bot: discord.Bot,
  applicationId: string,
  guildIds: string[],
): Promise<void> {
  const applicationCommands: discord.CreateApplicationCommand[] = [];

  // コマンドメタデータを変換
  for (const { metadata } of commands.values()) {
    applicationCommands.push({
      name: metadata.name,
      description: metadata.description,
      options: metadata.options,
      defaultMemberPermissions: metadata.defaultMemberPermissions,
      dmPermission: metadata.dmPermission,
    });
  }

  try {
    if (guildIds.length > 0) {
      // ギルド単位でコマンドを登録
      for (const guildId of guildIds) {
        await discord.bulkOverwriteGuildCommands(
          bot,
          guildId,
          applicationCommands,
        );
        logger.info(`ギルド ${guildId} にコマンドを登録しました`);
      }
    } else {
      // グローバルコマンドとして登録
      await discord.bulkOverwriteGlobalCommands(
        bot,
        applicationCommands,
      );
      logger.info('グローバルコマンドを登録しました');
    }
  } catch (error) {
    logger.error('コマンド登録エラー:', { error: error.message });
    throw error;
  }
}

/**
 * インタラクションを処理する
 * @param interaction インタラクション
 * @param bot Botインスタンス
 */
async function handleInteraction(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  // interactions.tsで定義されたハンドラに委譲
  const { handleButtonInteraction, handleModalInteraction } = await import('./interactions.ts');

  switch (interaction.type) {
    case discord.InteractionTypes.MessageComponent:
      if (interaction.data?.componentType === discord.ComponentTypes.Button) {
        await handleButtonInteraction(interaction, bot);
      }
      break;
    case discord.InteractionTypes.ModalSubmit:
      await handleModalInteraction(interaction, bot);
      break;
    default:
      logger.warn(`未対応のインタラクションタイプ: ${interaction.type}`);
  }
}

/**
 * エラーレスポンスを送信する
 * @param interaction インタラクション
 * @param bot Botインスタンス
 */
async function respondWithError(
  interaction: discord.Interaction,
  bot: discord.Bot,
): Promise<void> {
  try {
    await discord.respondToInteraction(bot, interaction, {
      content: '❌ エラーが発生しました。もう一度お試しください。',
      flags: discord.InteractionResponseFlags.Ephemeral,
    });
  } catch (error) {
    logger.error('エラーレスポンス送信失敗:', { error: error.message });
  }
}

/**
 * Botを起動する
 * @param bot Botインスタンス
 */
export async function startBot(bot: discord.Bot): Promise<void> {
  try {
    await discord.startBot(bot);
  } catch (error) {
    logger.error('Bot起動エラー:', { error: error.message });

    // 再接続を試みる（指数バックオフ）
    let retryDelay = 1000; // 1秒から開始
    const maxRetryDelay = 60000; // 最大60秒

    while (true) {
      logger.info(`${retryDelay / 1000}秒後に再接続を試みます...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));

      try {
        await discord.startBot(bot);
        logger.info('再接続に成功しました');
        break;
      } catch (retryError) {
        logger.error('再接続失敗:', { error: retryError.message });
        retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      }
    }
  }
}

// テストコード
Deno.test('コマンド登録が正しく動作すること', () => {
  const testMetadata: CommandMetadata = {
    name: 'test',
    description: 'Test command',
  };

  const testHandler: CommandHandler = async () => {
    // テストハンドラ
  };

  registerCommand(testMetadata, testHandler);

  const command = commands.get('test');
  assertExists(command);
  assertEquals(command.metadata.name, 'test');
});
