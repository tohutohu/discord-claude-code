/**
 * Discord ヘルパー関数のテスト
 */

import { assertEquals } from '../deps.ts';
import {
  deferResponse,
  editOriginalInteractionResponse,
  respondToInteraction,
  sendEphemeralResponse,
  showModal,
} from './helpers.ts';
import { InteractionResponseTypes } from '../deps.ts';
import { captureOutput } from '../types/test-utils.ts';

// モックのBot とInteraction
const mockBot = {} as Parameters<typeof respondToInteraction>[0];
const mockInteraction = {} as Parameters<typeof respondToInteraction>[1];

Deno.test('respondToInteraction: プレースホルダー実装でログ出力', () => {
  const capture = captureOutput();

  try {
    respondToInteraction(mockBot, mockInteraction, {
      type: InteractionResponseTypes.ChannelMessageWithSource,
      data: { content: 'test message' },
    });

    const output = capture.getOutput();
    assertEquals(output, 'Interaction response (placeholder)');
  } finally {
    capture.restore();
  }
});

Deno.test('editOriginalInteractionResponse: プレースホルダー実装でログ出力', () => {
  const capture = captureOutput();

  try {
    editOriginalInteractionResponse(mockBot, mockInteraction, {
      content: 'edited content',
      embeds: [],
      components: [],
    });

    const output = capture.getOutput();
    assertEquals(output, 'Edit interaction response (placeholder)');
  } finally {
    capture.restore();
  }
});

Deno.test('sendEphemeralResponse: プレースホルダー実装でログ出力', () => {
  const capture = captureOutput();

  try {
    sendEphemeralResponse(
      mockBot,
      mockInteraction,
      'This is an ephemeral message',
    );

    const output = capture.getOutput();
    assertEquals(output, 'Ephemeral response (placeholder)');
  } finally {
    capture.restore();
  }
});

Deno.test('deferResponse: プレースホルダー実装でログ出力（通常）', () => {
  const capture = captureOutput();

  try {
    // デフォルト（非エフェメラル）
    deferResponse(mockBot, mockInteraction);

    const output = capture.getOutput();
    assertEquals(output, 'Defer response (placeholder)');
  } finally {
    capture.restore();
  }
});

Deno.test('deferResponse: プレースホルダー実装でログ出力（エフェメラル）', () => {
  const capture = captureOutput();

  try {
    // エフェメラルモード
    deferResponse(mockBot, mockInteraction, true);

    const output = capture.getOutput();
    assertEquals(output, 'Defer response (placeholder)');
  } finally {
    capture.restore();
  }
});

Deno.test('showModal: プレースホルダー実装でログ出力', () => {
  const capture = captureOutput();

  try {
    const modal = {
      title: 'Test Modal',
      custom_id: 'test_modal',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'test_input',
              label: 'Test Input',
              style: 1,
              min_length: 1,
              max_length: 100,
              placeholder: 'Enter something',
              required: true,
            },
          ],
        },
      ],
    };

    showModal(mockBot, mockInteraction, modal);

    const output = capture.getOutput();
    assertEquals(output, 'Show modal (placeholder)');
  } finally {
    capture.restore();
  }
});

Deno.test('ヘルパー関数の引数型チェック', () => {
  // Bot型の確認
  const bot = {} as Parameters<typeof respondToInteraction>[0];
  assertEquals(typeof bot, 'object');

  // Interaction型の確認
  const interaction = {} as Parameters<typeof respondToInteraction>[1];
  assertEquals(typeof interaction, 'object');

  // InteractionResponseTypes の値を確認
  assertEquals(
    typeof InteractionResponseTypes.ChannelMessageWithSource,
    'number',
  );
  assertEquals(
    typeof InteractionResponseTypes.DeferredChannelMessageWithSource,
    'number',
  );
  assertEquals(typeof InteractionResponseTypes.Modal, 'number');
});

Deno.test('すべてのヘルパー関数が正しくエクスポートされている', () => {
  // 各関数が存在し、関数型であることを確認
  assertEquals(typeof respondToInteraction, 'function');
  assertEquals(typeof editOriginalInteractionResponse, 'function');
  assertEquals(typeof sendEphemeralResponse, 'function');
  assertEquals(typeof deferResponse, 'function');
  assertEquals(typeof showModal, 'function');
});
