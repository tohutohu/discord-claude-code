/**
 * Discord関連の型定義
 */

import { discord } from '../deps.ts';

/** コマンドのメタデータ */
export interface CommandMetadata {
  name: string;
  description: string;
  options?: discord.ApplicationCommandOption[];
  defaultMemberPermissions?: string[];
  dmPermission?: boolean;
}

/** コマンドハンドラの型 */
export type CommandHandler = (
  interaction: discord.Interaction,
  bot: discord.Bot,
) => Promise<void>;

/** インタラクションハンドラの型 */
export type InteractionHandler = (
  interaction: discord.Interaction,
  bot: discord.Bot,
) => Promise<void>;

/** ボタンインタラクションデータ */
export interface ButtonInteractionData {
  action: string;
  data?: Record<string, unknown>;
}

/** セッションメタデータ */
export interface SessionMetadata {
  threadId: string;
  channelId: string;
  guildId: string;
  userId: string;
  repository: string;
  branch?: string;
  createdAt: Date;
}

/** Discord設定の拡張 */
export interface DiscordConfig {
  token: string;
  applicationId: string;
  guildIds: string[];
  commandPrefix: string;
}
