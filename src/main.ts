import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { Admin } from "./admin.ts";
import { getEnv } from "./env.ts";

const env = await getEnv();
const admin = new Admin();

// Discord Clientの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// スラッシュコマンドの定義
const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("新しいチャットスレッドを開始します")
    .toJSON(),
];

// Bot起動時の処理
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`ログイン完了: ${readyClient.user.tag}`);

  // スラッシュコマンドを登録
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  try {
    console.log("スラッシュコマンドの登録を開始します...");

    await rest.put(
      Routes.applicationCommands(readyClient.user.id),
      { body: commands },
    );

    console.log("スラッシュコマンドの登録が完了しました！");
  } catch (error) {
    console.error("スラッシュコマンドの登録に失敗しました:", error);
  }
});

// スラッシュコマンドの処理
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "start") {
    try {
      if (!interaction.channel || !("threads" in interaction.channel)) {
        await interaction.reply("このチャンネルではスレッドを作成できません。");
        return;
      }

      // スレッドを作成
      const thread = await interaction.channel.threads.create({
        name: `chat-${Date.now()}`,
        autoArchiveDuration: 60,
        reason: "新しいチャットセッション",
      });

      if (!thread) {
        await interaction.reply("スレッドの作成に失敗しました。");
        return;
      }

      // Workerを作成
      const worker = await admin.createWorker(thread.id);

      await interaction.reply(
        `新しいチャットスレッドを作成しました: ${thread.toString()}`,
      );
      await thread.send(
        `こんにちは！私は${worker.getName()}です。何か質問はありますか？`,
      );
    } catch (error) {
      console.error("スレッド作成エラー:", error);
      await interaction.reply("エラーが発生しました。");
    }
  }
});

// メッセージの処理
client.on(Events.MessageCreate, async (message) => {
  // Bot自身のメッセージは無視
  if (message.author.bot) return;

  // スレッド内のメッセージのみ処理
  if (!message.channel.isThread()) return;

  const threadId = message.channel.id;

  try {
    // AdminにメッセージをルーティングしてWorkerからの返信を取得
    const reply = await admin.routeMessage(threadId, message.content);

    // Workerからの返信をDiscordに送信
    await message.reply(reply);
  } catch (error) {
    if ((error as Error).message.includes("Worker not found")) {
      // このスレッド用のWorkerがまだ作成されていない場合
      await message.reply(
        "このスレッドはアクティブではありません。/start コマンドで新しいスレッドを開始してください。",
      );
    } else {
      console.error("メッセージ処理エラー:", error);
      await message.reply("エラーが発生しました。");
    }
  }
});

// Botを起動
client.login(env.DISCORD_TOKEN);
