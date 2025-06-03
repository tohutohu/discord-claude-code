// Discord Bot ヘルパー関数
// Discordeno v21での操作を簡略化するためのラッパー

import type { Bot, Interaction } from '../deps.ts';
import { InteractionResponseTypes } from '../deps.ts';

/**
 * インタラクションに応答する
 */
export function respondToInteraction(
  _bot: Bot,
  _interaction: Interaction,
  _options: {
    type: InteractionResponseTypes;
    data?: Record<string, unknown>;
  },
): void {
  // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
  console.log('Interaction response (placeholder)');
}

/**
 * インタラクションの元の応答を編集する
 */
export function editOriginalInteractionResponse(
  _bot: Bot,
  _interaction: Interaction,
  _options: Record<string, unknown>,
): void {
  // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
  console.log('Edit interaction response (placeholder)');
}

/**
 * エフェメラル（一時的）な応答を送信する
 */
export function sendEphemeralResponse(
  _bot: Bot,
  _interaction: Interaction,
  _content: string,
): void {
  // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
  console.log('Ephemeral response (placeholder)');
}

/**
 * 遅延応答を送信する（処理中表示）
 */
export function deferResponse(
  _bot: Bot,
  _interaction: Interaction,
  _ephemeral = false,
): void {
  // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
  console.log('Defer response (placeholder)');
}

/**
 * Modal を表示する
 */
export function showModal(
  _bot: Bot,
  _interaction: Interaction,
  _modal: Record<string, unknown>,
): void {
  // TODO(v21): Discordeno v21のAPI変更により一時的に無効化
  console.log('Show modal (placeholder)');
}
