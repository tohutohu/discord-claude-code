import {
  AutocompleteInteraction,
  ButtonInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import { Admin } from "./admin.ts";
import { Worker } from "./worker.ts";
import { getEnv } from "./env.ts";
import { ensureRepository, parseRepository } from "./git-utils.ts";
import { RepositoryPatInfo, WorkspaceManager } from "./workspace.ts";
import {
  checkSystemRequirements,
  formatSystemCheckResults,
} from "./system-check.ts";
import { performGitUpdate } from "./git-update.ts";
import { generateThreadName, summarizeWithGemini } from "./gemini.ts";

// システム要件チェック
console.log("システム要件をチェックしています...");
const systemCheck = await checkSystemRequirements();
const checkResults = formatSystemCheckResults(
  systemCheck.results,
  systemCheck.missingRequired,
);
console.log(checkResults);

if (!systemCheck.success) {
  console.error(
    "\n❌ 必須コマンドが不足しているため、アプリケーションを終了します。",
  );
  Deno.exit(1);
}

console.log("\n✅ システム要件チェック完了\n");

const env = getEnv();
const workspaceManager = new WorkspaceManager(env.WORK_BASE_DIR);
await workspaceManager.initialize();
const admin = new Admin(
  workspaceManager,
  env.VERBOSE,
  env.CLAUDE_APPEND_SYSTEM_PROMPT,
  env.PLAMO_TRANSLATOR_URL,
);

if (env.VERBOSE) {
  console.log("🔍 VERBOSEモードが有効です - 詳細ログが出力されます");
}

// Discord Clientの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// スレッドクローズコールバックを設定
admin.setThreadCloseCallback(async (threadId: string) => {
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread && thread.isThread()) {
      await thread.setArchived(true);
      console.log(`スレッド ${threadId} をアーカイブしました`);
    }
  } catch (error) {
    console.error(`スレッド ${threadId} のアーカイブに失敗:`, error);
  }
});

// スラッシュコマンドの定義
const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("新しいチャットスレッドを開始します")
    .addStringOption((option) =>
      option.setName("repository")
        .setDescription("対象のGitHubリポジトリ（例: owner/repo）")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Discord Botのコードを最新版に更新します")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("set-pat")
    .setDescription("リポジトリ用のGitHub Fine-Grained PATを設定します")
    .addStringOption((option) =>
      option.setName("repository")
        .setDescription("対象のGitHubリポジトリ（例: owner/repo）")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option.setName("token")
        .setDescription("GitHub Fine-Grained PAT")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("description")
        .setDescription("トークンの説明（省略可）")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("list-pats")
    .setDescription("登録済みのGitHub PATの一覧を表示します")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("delete-pat")
    .setDescription("登録済みのGitHub PATを削除します")
    .addStringOption((option) =>
      option.setName("repository")
        .setDescription("対象のGitHubリポジトリ（例: owner/repo）")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .toJSON(),
];

// Bot起動時の処理
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`ログイン完了: ${readyClient.user.tag}`);

  // 自動再開コールバックを設定
  admin.setAutoResumeCallback(async (threadId: string, message: string) => {
    try {
      const channel = await readyClient.channels.fetch(threadId);
      if (channel && channel.isTextBased() && "send" in channel) {
        // スレッドから最新のメッセージを取得（リアクション用）
        const messages = await channel.messages.fetch({ limit: 10 });
        const userMessages = messages.filter((msg) => !msg.author.bot);
        const lastUserMessage = userMessages.first();

        // 進捗コールバック
        const onProgress = async (content: string) => {
          try {
            await channel.send({
              content: content,
              flags: 4096, // SUPPRESS_NOTIFICATIONS flag
            });
          } catch (sendError) {
            console.error("自動再開メッセージ送信エラー:", sendError);
          }
        };

        // リアクションコールバック
        const onReaction = async (emoji: string) => {
          if (lastUserMessage) {
            try {
              await lastUserMessage.react(emoji);
            } catch (error) {
              console.error("自動再開リアクション追加エラー:", error);
            }
          }
        };

        const reply = await admin.routeMessage(
          threadId,
          message,
          onProgress,
          onReaction,
        );

        if (typeof reply === "string") {
          await (channel as TextChannel).send(reply);
        } else {
          await (channel as TextChannel).send({
            content: reply.content,
            components: reply.components,
          });
        }
      }
    } catch (error) {
      console.error("自動再開メッセージ送信エラー:", error);
    }
  });

  // スレッドクローズコールバックを設定
  admin.setThreadCloseCallback(async (threadId: string) => {
    try {
      const channel = await readyClient.channels.fetch(threadId);
      if (channel && channel.type === ChannelType.PublicThread) {
        await (channel as ThreadChannel).setArchived(true);
        console.log(`スレッドをアーカイブしました: ${threadId}`);
      }
    } catch (error) {
      console.error(`スレッドのアーカイブに失敗しました (${threadId}):`, error);
    }
  });

  // アクティブなスレッドを復旧
  console.log("アクティブなスレッドを復旧しています...");
  await admin.restoreActiveThreads();
  console.log("スレッドの復旧が完了しました。");

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

// インタラクションの処理
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleSlashCommand(interaction);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  } else if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction);
  }
});

/**
 * ボタンインタラクションを処理する関数
 *
 * @param interaction - Discordのボタンインタラクション
 * @description
 * - 「再開」ボタン: レート制限後の会話再開
 * - 「devcontainer起動」ボタン: devcontainer環境の起動（プログレス表示付き）
 * - 「fallback devcontainer起動」ボタン: fallback devcontainer環境の起動（プログレス表示付き）
 * - 「終了」ボタン: スレッドの終了処理
 *
 * devcontainer起動時は、リアルタイムでプログレスメッセージを更新し、
 * 起動ログを表示します。最大20行のログを保持し、1秒ごとに更新されます。
 *
 * @throws {Error} インタラクション処理中にエラーが発生した場合
 */
async function handleButtonInteraction(interaction: ButtonInteraction) {
  try {
    const threadId = interaction.channel?.id;
    if (!threadId) {
      await interaction.reply("スレッドIDが取得できませんでした。");
      return;
    }

    await interaction.deferReply();

    const result = await admin.handleButtonInteraction(
      threadId,
      interaction.customId,
    );

    // devcontainerの起動処理を特別扱い
    if (result === "devcontainer_start_with_progress") {
      // 初期メッセージを送信してメッセージIDを保持
      let progressMessage: Message | undefined;
      if (interaction.channel && "send" in interaction.channel) {
        progressMessage = await interaction.channel.send({
          content: "🐳 devcontainerを起動しています...",
          // @ts-ignore - Discord.js v14では flags: 4096 が正しいが型定義が不完全
          flags: 4096, // SUPPRESS_NOTIFICATIONS flag
        });
      }

      await interaction.editReply(
        "devcontainerの起動を開始しました。進捗は下のメッセージで確認できます。",
      );

      let lastUpdateTime = Date.now();
      const UPDATE_INTERVAL = 1000; // 1秒ごとに更新可能
      let accumulatedLogs: string[] = [];
      const MAX_LOG_LINES = 20; // 表示する最大ログ行数

      // 進捗更新用のコールバック（既存メッセージを編集）
      const onProgress = async (content: string) => {
        const now = Date.now();

        // ログを蓄積
        if (content.includes("```")) {
          // コードブロック内のログを抽出
          const match = content.match(/```\n([\s\S]*?)\n```/);
          if (match) {
            const logLines = match[1].split("\n").filter((line) => line.trim());
            accumulatedLogs.push(...logLines);
            // 最新のログのみ保持
            if (accumulatedLogs.length > MAX_LOG_LINES) {
              accumulatedLogs = accumulatedLogs.slice(-MAX_LOG_LINES);
            }
          }
        } else {
          // 通常のメッセージはそのまま追加
          accumulatedLogs.push(content);
          if (accumulatedLogs.length > MAX_LOG_LINES) {
            accumulatedLogs = accumulatedLogs.slice(-MAX_LOG_LINES);
          }
        }

        // 更新間隔をチェック
        if (now - lastUpdateTime >= UPDATE_INTERVAL && progressMessage) {
          try {
            // メッセージを更新
            const logContent = accumulatedLogs.length > 0
              ? `\n\`\`\`\n${accumulatedLogs.join("\n")}\n\`\`\``
              : "";
            await progressMessage.edit({
              content: `🐳 **devcontainer起動中...**${logContent}`,
            });
            lastUpdateTime = now;
          } catch (editError) {
            console.error("メッセージ編集エラー:", editError);
          }
        }
      };

      // devcontainerを起動
      const startResult = await admin.startDevcontainerForWorker(
        threadId,
        onProgress,
      );

      const worker = admin.getWorker(threadId);

      if (startResult.success) {
        // 最終的な成功メッセージでプログレスメッセージを更新
        if (progressMessage) {
          try {
            await progressMessage.edit({
              content:
                `✅ **devcontainer起動完了！**\n\n${startResult.message}\n\n準備完了です！何かご質問をどうぞ。`,
            });
          } catch (editError) {
            console.error("最終メッセージ編集エラー:", editError);
            // 編集に失敗した場合は新規メッセージを送信
            if (interaction.channel && "send" in interaction.channel) {
              await interaction.channel.send(
                `<@${interaction.user.id}> ${startResult.message}\n\n準備完了です！何かご質問をどうぞ。`,
              );
            }
          }
        }

        // ユーザーにメンション付きで通知
        if (interaction.channel && "send" in interaction.channel) {
          await interaction.channel.send(
            `<@${interaction.user.id}> devcontainerの準備が完了しました！`,
          );
        }
      } else {
        if (worker) {
          (worker as Worker).setUseDevcontainer(false);
        }

        // エラーメッセージでプログレスメッセージを更新
        if (progressMessage) {
          try {
            await progressMessage.edit({
              content:
                `❌ **devcontainer起動失敗**\n\n${startResult.message}\n\n通常環境でClaude実行を継続します。`,
            });
          } catch (editError) {
            console.error("エラーメッセージ編集エラー:", editError);
          }
        }

        // ユーザーにメンション付きで通知
        if (interaction.channel && "send" in interaction.channel) {
          await interaction.channel.send(
            `<@${interaction.user.id}> devcontainerの起動に失敗しました。通常環境でClaude実行を継続します。`,
          );
        }
      }
    } else if (result === "fallback_devcontainer_start_with_progress") {
      // fallback devcontainerの起動処理
      await interaction.editReply(
        "📦 fallback devcontainerを起動しています...",
      );

      const logs: string[] = [];
      let lastUpdateTime = Date.now();
      const updateInterval = 1000; // 1秒
      const maxLogLines = 20;

      // タイマーIDを保存
      // deno-lint-ignore prefer-const
      let timerId: number | undefined;

      // 定期的な更新処理
      const updateProgress = async () => {
        try {
          if (logs.length > 0) {
            const logSection = logs.slice(-maxLogLines).join("\n");
            await interaction.editReply({
              content:
                `📦 fallback devcontainerを起動しています...\n\n**ログ:**\n\`\`\`\n${logSection}\n\`\`\`\n\n⏳ 初回起動は数分かかる場合があります。`,
            });
          }
        } catch (error) {
          console.error("進捗更新エラー:", error);
        }
      };

      // 定期的な更新タイマーを開始
      timerId = setInterval(updateProgress, updateInterval);

      try {
        // fallback devcontainerを起動
        const startResult = await admin.startFallbackDevcontainerForWorker(
          threadId,
          async (message) => {
            // 進捗メッセージをログに追加
            logs.push(message);

            // 即座の更新が必要なメッセージパターン
            const importantPatterns = [
              "pulling",
              "downloading",
              "extracting",
              "building",
              "creating",
              "starting",
              "waiting",
              "complete",
              "success",
              "error",
              "failed",
            ];

            const isImportant = importantPatterns.some((pattern) =>
              message.toLowerCase().includes(pattern)
            );

            if (isImportant && Date.now() - lastUpdateTime > 500) {
              lastUpdateTime = Date.now();
              await updateProgress();
            }
          },
        );

        // タイマーをクリア
        clearInterval(timerId);

        // 最終結果を更新
        if (startResult.success) {
          const finalLogs = logs.slice(-10).join("\n");
          await interaction.editReply({
            content:
              `✅ fallback devcontainerが正常に起動しました！\n\n**最終ログ:**\n\`\`\`\n${finalLogs}\n\`\`\`\n\n準備完了です！何かご質問をどうぞ。`,
          });

          // ユーザーにメンション付きで通知
          if (interaction.channel && "send" in interaction.channel) {
            await interaction.channel.send(
              `<@${interaction.user.id}> fallback devcontainerの起動が完了しました！Claude実行環境が準備完了です。`,
            );
          }
        } else {
          await interaction.editReply({
            content:
              `❌ fallback devcontainerの起動に失敗しました。\n\nエラー: ${startResult.message}`,
          });

          // ユーザーにメンション付きで通知
          if (interaction.channel && "send" in interaction.channel) {
            await interaction.channel.send(
              `<@${interaction.user.id}> fallback devcontainerの起動に失敗しました。通常環境でClaude実行を継続します。`,
            );
          }
        }
      } catch (error) {
        // エラーが発生した場合もタイマーをクリア
        if (timerId) {
          clearInterval(timerId);
        }

        console.error("fallback devcontainer起動エラー:", error);
        await interaction.editReply({
          content: `❌ fallback devcontainerの起動中にエラーが発生しました: ${
            (error as Error).message
          }`,
        });
      }
    } else {
      await interaction.editReply(result);
    }
  } catch (error) {
    console.error("ボタンインタラクションエラー:", error);
    try {
      await interaction.editReply("エラーが発生しました。");
    } catch {
      await interaction.reply("エラーが発生しました。");
    }
  }
}

/**
 * オートコンプリート機能を処理する関数
 *
 * @param interaction - Discordのオートコンプリートインタラクション
 * @description
 * スラッシュコマンドの入力補完を提供します。
 * 対応コマンド:
 * - /start: リポジトリ名の補完
 * - /set-pat: リポジトリ名の補完
 * - /delete-pat: リポジトリ名の補完
 *
 * ローカルに存在するリポジトリ一覧から、入力文字列に部分一致するものを
 * 最大25件まで候補として表示します（Discord.jsの制限）。
 *
 * @throws {Error} オートコンプリート処理中にエラーが発生した場合（エラー時は空の選択肢を返す）
 */
async function handleAutocomplete(interaction: AutocompleteInteraction) {
  try {
    const supportedCommands = ["start", "set-pat", "delete-pat"];
    if (supportedCommands.includes(interaction.commandName)) {
      const focusedOption = interaction.options.getFocused(true);

      if (focusedOption.name === "repository") {
        const localRepositories = await workspaceManager.getLocalRepositories();
        const input = focusedOption.value.toLowerCase();

        // 入力文字列でフィルタリング
        const filtered = localRepositories.filter((repo) =>
          repo.toLowerCase().includes(input)
        );

        // Discord.jsの制限により最大25件まで
        const choices = filtered.slice(0, 25).map((repo) => ({
          name: repo,
          value: repo,
        }));

        await interaction.respond(choices);
      }
    }
  } catch (error) {
    console.error("オートコンプリートエラー:", error);
    // エラー時は空の選択肢を返す
    await interaction.respond([]);
  }
}

/**
 * スラッシュコマンドを処理する関数
 *
 * @param interaction - Discordのスラッシュコマンドインタラクション
 * @description
 * 以下のコマンドを処理します：
 *
 * - /start repository:<リポジトリ名>
 *   指定したGitHubリポジトリ用の新しいチャットスレッドを作成。
 *   リポジトリのクローン/更新、Workerの作成、devcontainerの確認を行います。
 *
 * - /update
 *   Discord Bot自体のコードを最新版に更新（git pull）。
 *   HMRが有効な場合は自動的に反映されます。
 *
 * - /set-pat repository:<リポジトリ名> token:<PAT> [description:<説明>]
 *   プライベートリポジトリ用のGitHub Fine-Grained PATを設定。
 *   devcontainer使用時に自動的に環境変数として設定されます。
 *
 * - /list-pats
 *   登録済みのGitHub PAT一覧を表示（トークンは部分マスク表示）。
 *
 * - /delete-pat repository:<リポジトリ名>
 *   指定したリポジトリのPATを削除。
 *
 * @throws {Error} コマンド処理中にエラーが発生した場合
 */
async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "set-pat") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const repositorySpec = interaction.options.getString("repository", true);
      const token = interaction.options.getString("token", true);
      const description = interaction.options.getString("description");

      // リポジトリ名をパース
      let repository;
      try {
        repository = parseRepository(repositorySpec);
      } catch (error) {
        await interaction.editReply(`エラー: ${(error as Error).message}`);
        return;
      }

      // PAT情報を保存
      const patInfo: RepositoryPatInfo = {
        repositoryFullName: repository.fullName,
        token,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: description || undefined,
      };

      await workspaceManager.saveRepositoryPat(patInfo);

      await interaction.editReply(
        `✅ ${repository.fullName}のGitHub PATを設定しました。${
          description ? `\n説明: ${description}` : ""
        }\n\n今後このリポジトリでdevcontainerを使用する際に、このPATが自動的に環境変数として設定されます。`,
      );
    } catch (error) {
      console.error("PAT設定エラー:", error);
      await interaction.editReply("エラーが発生しました。");
    }
  } else if (commandName === "list-pats") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const pats = await workspaceManager.listRepositoryPats();

      if (pats.length === 0) {
        await interaction.editReply("登録済みのGitHub PATはありません。");
        return;
      }

      const patList = pats
        .map((pat) => {
          const maskedToken = `${pat.token.substring(0, 7)}...${
            pat.token.substring(pat.token.length - 4)
          }`;
          return `• **${pat.repositoryFullName}**\n  トークン: \`${maskedToken}\`${
            pat.description ? `\n  説明: ${pat.description}` : ""
          }\n  登録日: ${new Date(pat.createdAt).toLocaleString("ja-JP")}`;
        })
        .join("\n\n");

      await interaction.editReply(
        `📋 **登録済みのGitHub PAT一覧**\n\n${patList}`,
      );
    } catch (error) {
      console.error("PAT一覧取得エラー:", error);
      await interaction.editReply("エラーが発生しました。");
    }
  } else if (commandName === "delete-pat") {
    try {
      await interaction.deferReply({ ephemeral: true });

      const repositorySpec = interaction.options.getString("repository", true);

      // リポジトリ名をパース
      let repository;
      try {
        repository = parseRepository(repositorySpec);
      } catch (error) {
        await interaction.editReply(`エラー: ${(error as Error).message}`);
        return;
      }

      await workspaceManager.deleteRepositoryPat(repository.fullName);

      await interaction.editReply(
        `✅ ${repository.fullName}のGitHub PATを削除しました。`,
      );
    } catch (error) {
      console.error("PAT削除エラー:", error);
      await interaction.editReply("エラーが発生しました。");
    }
  } else if (commandName === "update") {
    try {
      await interaction.deferReply();

      // Git操作を実行
      const updateResult = await performGitUpdate();

      if (updateResult.success) {
        await interaction.editReply(
          `✅ 更新が完了しました！\n\n${updateResult.message}\n\n⚠️ Botを再起動してください。HMRが有効な場合は自動的に反映されます。`,
        );
      } else {
        await interaction.editReply(
          `❌ 更新に失敗しました。\n\n${updateResult.message}`,
        );
      }
    } catch (error) {
      console.error("更新コマンドエラー:", error);
      await interaction.editReply("エラーが発生しました。");
    }
  } else if (commandName === "start") {
    try {
      if (!interaction.channel || !("threads" in interaction.channel)) {
        await interaction.reply("このチャンネルではスレッドを作成できません。");
        return;
      }

      // リポジトリ引数を取得
      const repositorySpec = interaction.options.getString("repository", true);

      // リポジトリ名をパース
      let repository;
      try {
        repository = parseRepository(repositorySpec);
      } catch (error) {
        await interaction.reply(`エラー: ${(error as Error).message}`);
        return;
      }

      // インタラクションを遅延レスポンスで処理（clone処理が時間がかかる可能性があるため）
      await interaction.deferReply();

      // リポジトリをclone/更新
      let repositoryResult;
      try {
        repositoryResult = await ensureRepository(repository, workspaceManager);
      } catch (error) {
        await interaction.editReply(
          `リポジトリの取得に失敗しました: ${(error as Error).message}`,
        );
        return;
      }

      // スレッドを作成
      const thread = await interaction.channel.threads.create({
        name: `${repository.fullName}-${Date.now()}`,
        autoArchiveDuration: 60,
        reason: `${repository.fullName}のチャットセッション`,
      });

      if (!thread) {
        await interaction.editReply("スレッドの作成に失敗しました。");
        return;
      }

      // Workerを作成してリポジトリ情報を設定
      const worker = await admin.createWorker(thread.id);
      await worker.setRepository(repository, repositoryResult.path);

      // 更新状況に応じたメッセージを作成
      let statusMessage = repositoryResult.wasUpdated
        ? `${repository.fullName}の既存リポジトリをデフォルトブランチの最新に更新しました。`
        : `${repository.fullName}を新規取得しました。`;

      // メタデータがある場合は追加情報を表示
      if (repositoryResult.metadata) {
        const metadata = repositoryResult.metadata;
        const repoInfo = [
          metadata.description ? `説明: ${metadata.description}` : "",
          metadata.language ? `言語: ${metadata.language}` : "",
          `デフォルトブランチ: ${metadata.defaultBranch}`,
          metadata.isPrivate
            ? "🔒 プライベートリポジトリ"
            : "🌐 パブリックリポジトリ",
        ].filter(Boolean).join(" | ");

        statusMessage += `\n📋 ${repoInfo}`;
      }

      await interaction.editReply(
        `${statusMessage}\nチャットスレッドを作成しました: ${thread.toString()}`,
      );

      // devcontainer.jsonの存在確認と設定
      const devcontainerInfo = await admin.checkAndSetupDevcontainer(
        thread.id,
        repositoryResult.path,
      );

      // 初期メッセージを終了ボタン付きで送信
      const initialMessage = admin.createInitialMessage(thread.id);
      const greeting =
        `こんにちは！私は${worker.getName()}です。${repository.fullName}について何か質問はありますか？\n\n`;

      let devcontainerMessage = "";
      if (devcontainerInfo.warning) {
        devcontainerMessage += `${devcontainerInfo.warning}\n\n`;
      }
      devcontainerMessage += devcontainerInfo.message;

      // devcontainerの設定ボタンがある場合はそれを使用、ない場合は終了ボタンのみ
      const components = devcontainerInfo.components ||
        initialMessage.components;

      await thread.send({
        content:
          `${greeting}${devcontainerMessage}\n\n${initialMessage.content}`,
        components: components,
      });
    } catch (error) {
      console.error("スレッド作成エラー:", error);
      try {
        await interaction.editReply("エラーが発生しました。");
      } catch {
        await interaction.reply("エラーが発生しました。");
      }
    }
  }
}

// スレッドアーカイブイベントの処理
client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
  // アーカイブ状態が変更された場合のみ処理
  if (!oldThread.archived && newThread.archived) {
    console.log(`スレッド ${newThread.id} がアーカイブされました`);

    try {
      // Workerの終了処理
      await admin.terminateThread(newThread.id);
      console.log(`スレッド ${newThread.id} のWorkerとworktreeを削除しました`);
    } catch (error) {
      console.error(`スレッド ${newThread.id} の終了処理でエラー:`, error);
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
  const thread = message.channel as ThreadChannel;

  // GEMINI_API_KEYが設定されていて、スレッド名が一時的なものの場合、最初のメッセージで名前を更新（非同期）
  if (env.GEMINI_API_KEY && thread.name.match(/^[\w-]+\/[\w-]+-\d+$/)) {
    console.log(
      `[ThreadRename] 開始: スレッドID=${threadId}, 現在の名前="${thread.name}"`,
    );

    // スレッド名生成を非同期で実行（メッセージ処理をブロックしない）
    (async () => {
      try {
        // スレッド情報を取得
        console.log(`[ThreadRename] スレッド情報を取得中...`);
        const threadInfo = await workspaceManager.loadThreadInfo(threadId);

        if (!threadInfo) {
          console.log(
            `[ThreadRename] スレッド情報が見つかりません: threadId=${threadId}`,
          );
          // スレッド情報がなくても続行（リポジトリ名なしで要約のみ使用）
        } else if (threadInfo.repositoryFullName) {
          console.log(
            `[ThreadRename] リポジトリ名: ${threadInfo.repositoryFullName}`,
          );
        } else {
          console.log(
            `[ThreadRename] リポジトリ名が設定されていません。要約のみでスレッド名を生成します`,
          );
        }

        // Gemini APIで要約
        console.log(
          `[ThreadRename] Gemini APIで要約を生成中... メッセージ長=${message.content.length}`,
        );
        const summarizeResult = await summarizeWithGemini(
          env.GEMINI_API_KEY!, // 既にif文でチェック済み
          message.content,
          30, // 最大30文字
        );

        if (!summarizeResult.success) {
          console.log(
            `[ThreadRename] Gemini API失敗: ${JSON.stringify(summarizeResult)}`,
          );
          return;
        }

        if (!summarizeResult.summary) {
          console.log(`[ThreadRename] 要約が空です`);
          return;
        }

        console.log(
          `[ThreadRename] 要約生成成功: "${summarizeResult.summary}"`,
        );

        // スレッド名を生成
        const newThreadName = generateThreadName(
          summarizeResult.summary,
          threadInfo?.repositoryFullName ?? undefined,
        );

        console.log(`[ThreadRename] 新しいスレッド名: "${newThreadName}"`);

        // スレッド名を更新
        console.log(`[ThreadRename] Discord APIでスレッド名を更新中...`);
        await thread.setName(newThreadName);

        console.log(
          `[ThreadRename] 成功: "${thread.name}" -> "${newThreadName}"`,
        );
      } catch (error) {
        console.error("[ThreadRename] エラー:", error);
        console.error("[ThreadRename] エラースタック:", (error as Error).stack);
        // エラーが発生してもメッセージ処理には影響しない
      }
    })(); // 即時実行してawaitしない
  }

  // /configコマンドの処理
  if (message.content.startsWith("/config devcontainer ")) {
    const parts = message.content.split(" ");
    if (parts.length >= 3) {
      const setting = parts[2].toLowerCase();
      const worker = admin.getWorker(threadId);

      if (!worker) {
        await message.channel.send(
          "このスレッドはアクティブではありません。/start コマンドで新しいスレッドを開始してください。",
        );
        return;
      }

      if (setting === "on") {
        (worker as Worker).setUseDevcontainer(true);
        await message.channel.send(
          `<@${message.author.id}> devcontainer環境での実行を設定しました。\n\n準備完了です！何かご質問をどうぞ。`,
        );
      } else if (setting === "off") {
        (worker as Worker).setUseDevcontainer(false);
        await message.channel.send(
          `<@${message.author.id}> ホスト環境での実行を設定しました。\n\n準備完了です！何かご質問をどうぞ。`,
        );
      } else {
        await message.channel.send(
          `<@${message.author.id}> 不正な設定値です。'/config devcontainer on' または '/config devcontainer off' を使用してください。`,
        );
      }
      return;
    }
  }

  try {
    let lastUpdateTime = Date.now();
    const UPDATE_INTERVAL = 2000; // 2秒ごとに更新

    // 進捗更新用のコールバック（新規メッセージ投稿、通知なし）
    const onProgress = async (content: string) => {
      const now = Date.now();
      if (now - lastUpdateTime >= UPDATE_INTERVAL) {
        try {
          await message.channel.send({
            content: content,
            flags: 4096, // SUPPRESS_NOTIFICATIONS flag
          });
          lastUpdateTime = now;
        } catch (sendError) {
          console.error("メッセージ送信エラー:", sendError);
        }
      }
    };

    // リアクション追加用のコールバック
    const onReaction = async (emoji: string) => {
      try {
        await message.react(emoji);
      } catch (error) {
        console.error("リアクション追加エラー:", error);
      }
    };

    // AdminにメッセージをルーティングしてWorkerからの返信を取得
    const reply = await admin.routeMessage(
      threadId,
      message.content,
      onProgress,
      onReaction,
      message.id,
      message.author.id,
    );

    // 最終的な返信を送信
    if (typeof reply === "string") {
      // 通常のテキストレスポンス（メンション付きで通知あり）
      await message.channel.send(`<@${message.author.id}> ${reply}`);
    } else {
      // DiscordMessage形式（ボタン付きメッセージなど）
      await message.channel.send({
        content: `<@${message.author.id}> ${reply.content}`,
        components: reply.components,
      });
    }
  } catch (error) {
    if ((error as Error).message.includes("Worker not found")) {
      // このスレッド用のWorkerがまだ作成されていない場合
      await message.channel.send(
        "このスレッドはアクティブではありません。/start コマンドで新しいスレッドを開始してください。",
      );
    } else {
      console.error("メッセージ処理エラー:", error);
      await message.channel.send("エラーが発生しました。");
    }
  }
});

// Botを起動
client.login(env.DISCORD_TOKEN);
