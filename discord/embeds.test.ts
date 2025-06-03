// Discord Embed 生成ヘルパー関数群のテスト

import { assertEquals, assertExists } from '../deps.ts';
import {
  createBaseEmbed,
  createErrorEmbed,
  createInfoEmbed,
  createProgressBar,
  createQueueEmbed,
  createRunningEmbed,
  createRunningSessionEmbed,
  createSessionCompleteEmbed,
  createSessionListEmbed,
  createSessionStartEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  ProgressUpdateController,
} from './embeds.ts';
import type { ExecutionStats, SessionInfo } from '../types/discord.ts';
import { EmbedColor, SessionState } from '../types/discord.ts';

Deno.test('基本的なEmbed生成のテスト', () => {
  const embed = createBaseEmbed({
    title: 'テストタイトル',
    description: 'テスト説明',
    color: EmbedColor.INFO,
  });

  assertEquals(embed.title, 'テストタイトル');
  assertEquals(embed.description, 'テスト説明');
  assertEquals(embed.color, EmbedColor.INFO);
  assertExists(embed.footer);
  assertEquals(embed.footer.text, 'Claude Bot');
  assertExists(embed.timestamp);
});

Deno.test('成功Embedの生成テスト', () => {
  const embed = createSuccessEmbed('成功', '処理が完了しました');

  assertEquals(embed.title, '成功');
  assertEquals(embed.description, '処理が完了しました');
  assertEquals(embed.color, EmbedColor.SUCCESS);
});

Deno.test('エラーEmbedの生成テスト', () => {
  const embed = createErrorEmbed('エラー', 'エラーが発生しました');

  assertEquals(embed.title, 'エラー');
  assertEquals(embed.description, 'エラーが発生しました');
  assertEquals(embed.color, EmbedColor.ERROR);
});

Deno.test('情報Embedの生成テスト', () => {
  const embed = createInfoEmbed('情報', '情報メッセージです');

  assertEquals(embed.title, '情報');
  assertEquals(embed.description, '情報メッセージです');
  assertEquals(embed.color, EmbedColor.INFO);
});

Deno.test('実行中Embedの生成テスト', () => {
  const embed = createRunningEmbed('実行中', '処理を実行しています');

  assertEquals(embed.title, '実行中');
  assertEquals(embed.description, '処理を実行しています');
  assertEquals(embed.color, EmbedColor.RUNNING);
});

Deno.test('警告Embedの生成テスト', () => {
  const embed = createWarningEmbed('警告', '注意が必要です');

  assertEquals(embed.title, '警告');
  assertEquals(embed.description, '注意が必要です');
  assertEquals(embed.color, EmbedColor.WARNING);
});

Deno.test('フィールド制限のテスト（25個制限）', () => {
  const testFields = Array.from({ length: 30 }, (_, i) => ({
    name: `フィールド${i + 1}`,
    value: `値${i + 1}`,
    inline: false,
  }));

  const embed = createBaseEmbed({
    title: 'フィールド制限テスト',
    fields: testFields,
  });

  // 最大25個まで制限されることを確認
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 25);
  const embedFields = embed.fields!;
  assertEquals(embedFields[0]!.name, 'フィールド1');
  assertEquals(embedFields[24]!.name, 'フィールド25');
});

Deno.test('カスタムフッターとタイムスタンプのテスト', () => {
  const timestamp = new Date('2025-01-01T00:00:00Z');

  const embed = createBaseEmbed({
    title: 'フッターテスト',
    footer: {
      text: 'カスタムフッター',
      iconUrl: 'https://example.com/icon.png',
    },
    timestamp,
  });

  assertEquals(embed.footer?.text, 'カスタムフッター');
  assertEquals(embed.footer?.icon_url, 'https://example.com/icon.png');
  assertEquals(embed.timestamp, timestamp.toISOString());
});

Deno.test('セッション開始Embedの生成テスト', () => {
  const sessionInfo: SessionInfo = {
    threadId: '123456789012345678',
    repository: 'test-repo',
    worktreePath: '/path/to/worktree',
    state: SessionState.STARTING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      userId: 'user123',
      guildId: 'guild123',
      startedAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const embed = createSessionStartEmbed(sessionInfo);

  assertEquals(embed.title, 'セッション開始 🚀');
  assertEquals(embed.description, 'リポジトリ **test-repo** でのセッションを開始しました');
  assertEquals(embed.color, EmbedColor.SUCCESS);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 3);
  const embedFields = embed.fields!;
  assertEquals(embedFields[0]!.name, 'リポジトリ');
  assertEquals(embedFields[0]!.value, 'test-repo');
});

Deno.test('セッション完了Embedの生成テスト（成功）', () => {
  const sessionInfo: SessionInfo = {
    threadId: '123456789012345678',
    repository: 'test-repo',
    worktreePath: '/path/to/worktree',
    state: SessionState.COMPLETED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      userId: 'user123',
      guildId: 'guild123',
      startedAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const stats: ExecutionStats = {
    startTime: new Date('2025-01-01T00:00:00Z'),
    endTime: new Date('2025-01-01T00:05:00Z'),
    duration: 300000, // 5分
    success: true,
    modifiedFiles: 3,
    linesAdded: 15,
    linesDeleted: 5,
  };

  const embed = createSessionCompleteEmbed(sessionInfo, stats);

  assertEquals(embed.title, 'セッション完了 ✅');
  assertEquals(embed.description, 'リポジトリ **test-repo** での作業が完了しました');
  assertEquals(embed.color, EmbedColor.SUCCESS);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 4); // 実行時間、ステータス、変更ファイル数、変更行数
});

Deno.test('セッション完了Embedの生成テスト（失敗）', () => {
  const sessionInfo: SessionInfo = {
    threadId: '123456789012345678',
    repository: 'test-repo',
    worktreePath: '/path/to/worktree',
    state: SessionState.ERROR,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      userId: 'user123',
      guildId: 'guild123',
      startedAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const stats: ExecutionStats = {
    startTime: new Date('2025-01-01T00:00:00Z'),
    endTime: new Date('2025-01-01T00:05:00Z'),
    duration: 300000,
    success: false,
    error: 'エラーが発生しました',
  };

  const embed = createSessionCompleteEmbed(sessionInfo, stats);

  assertEquals(embed.title, 'セッション失敗 ❌');
  assertEquals(embed.description, 'リポジトリ **test-repo** での作業が失敗しました');
  assertEquals(embed.color, EmbedColor.ERROR);
});

Deno.test('セッション一覧Embedの生成テスト（空）', () => {
  const embed = createSessionListEmbed([], 0, 3);

  assertEquals(embed.title, 'セッション一覧');
  assertEquals(embed.description, 'アクティブなセッションはありません');
  assertEquals(embed.color, EmbedColor.INFO);
});

Deno.test('セッション一覧Embedの生成テスト（データあり）', () => {
  const sessions: SessionInfo[] = [
    {
      threadId: '123456789012345678',
      repository: 'repo1',
      worktreePath: '/path/to/worktree1',
      state: SessionState.RUNNING,
      createdAt: new Date('2025-01-01T00:00:00Z').toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        userId: 'user123',
        guildId: 'guild123',
        startedAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date(),
      },
    },
  ];

  const embed = createSessionListEmbed(sessions, 1, 3);

  assertEquals(embed.title, 'セッション一覧');
  assertEquals(embed.description, 'アクティブセッション: 1/3');
  assertEquals(embed.color, EmbedColor.INFO);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 1);
  const embedFields = embed.fields!;
  assertEquals(embedFields[0]!.name, '🔵 repo1');
});

Deno.test('キュー待機Embedの生成テスト', () => {
  const embed = createQueueEmbed('test-repo', 2, 300);

  assertEquals(embed.title, 'キュー待機中 ⏳');
  assertEquals(embed.description, 'リポジトリ **test-repo** のセッション開始を待機しています');
  assertEquals(embed.color, EmbedColor.WARNING);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 2);
  const embedFields = embed.fields!;
  assertEquals(embedFields[0]!.name, 'キュー位置');
  assertEquals(embedFields[0]!.value, '2番目');
  assertEquals(embedFields[1]!.name, '推定待機時間');
  assertEquals(embedFields[1]!.value, '約5分');
});

Deno.test('キュー待機Embedの生成テスト（推定時間なし）', () => {
  const embed = createQueueEmbed('test-repo', 1);

  assertExists(embed.fields);
  const embedFields = embed.fields!;
  assertEquals(embedFields[1]!.value, '計算中...');
});

Deno.test('プログレスバーの生成テスト（基本）', () => {
  const progressBar = createProgressBar({
    progress: 60,
    length: 10,
  });

  assertEquals(progressBar, '[▓▓▓▓▓▓░░░░] 60%');
});

Deno.test('プログレスバーの生成テスト（時間情報付き）', () => {
  const progressBar = createProgressBar({
    progress: 75,
    length: 8,
    elapsedTime: 225, // 3分45秒
    estimatedTimeRemaining: 75, // 1分15秒
  });

  assertEquals(progressBar, '[▓▓▓▓▓▓░░] 75% (03:45 / 残り01:15)');
});

Deno.test('プログレスバーの生成テスト（カスタム文字）', () => {
  const progressBar = createProgressBar({
    progress: 30,
    length: 5,
    filledChar: '█',
    emptyChar: '▒',
  });

  // 30% × 5 = 1.5 → Math.round(1.5) = 2文字分塗りつぶし
  assertEquals(progressBar, '[██▒▒▒] 30%');
});

Deno.test('プログレスバーの生成テスト（境界値）', () => {
  // 0%
  const progressBar0 = createProgressBar({ progress: 0, length: 5 });
  assertEquals(progressBar0, '[░░░░░] 0%');

  // 100%
  const progressBar100 = createProgressBar({ progress: 100, length: 5 });
  assertEquals(progressBar100, '[▓▓▓▓▓] 100%');

  // 負の値（0%にクランプ）
  const progressBarNeg = createProgressBar({ progress: -10, length: 5 });
  assertEquals(progressBarNeg, '[░░░░░] 0%');

  // 100%超（100%にクランプ）
  const progressBarOver = createProgressBar({ progress: 150, length: 5 });
  assertEquals(progressBarOver, '[▓▓▓▓▓] 100%');
});

Deno.test('実行中セッションEmbedの生成テスト', () => {
  const sessionInfo: SessionInfo = {
    threadId: '123456789012345678',
    repository: 'test-repo',
    worktreePath: '/path/to/worktree',
    state: SessionState.RUNNING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      userId: 'user123',
      guildId: 'guild123',
      startedAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const logs = [
    'ファイルを解析中...',
    'Claude Code を実行中...',
    'コード生成中...',
  ];

  const embed = createRunningSessionEmbed(
    sessionInfo,
    45,
    180, // 3分
    'コード生成中',
    logs,
  );

  assertEquals(embed.title, '実行中... 🔄');
  assertEquals(embed.description, 'リポジトリ **test-repo** での作業を実行中');
  assertEquals(embed.color, EmbedColor.RUNNING);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 4); // 進捗、ステータス、稼働時間、最新ログ

  const embedFields = embed.fields!;
  // 進捗フィールドの確認
  assertEquals(embedFields[0]!.name, '進捗');
  assertEquals(embedFields[0]!.value.includes('[▓▓▓▓▓▓▓░░░░░░░░] 45% (03:00)'), true);

  // ステータスフィールドの確認
  assertEquals(embedFields[1]!.name, 'ステータス');
  assertEquals(embedFields[1]!.value, 'コード生成中');

  // 稼働時間フィールドの確認
  assertEquals(embedFields[2]!.name, '稼働時間');
  assertEquals(embedFields[2]!.value, '03:00');

  // ログフィールドの確認
  assertEquals(embedFields[3]!.name, '最新ログ');
  assertEquals(embedFields[3]!.value.includes('ファイルを解析中...'), true);
});

Deno.test('ProgressUpdateController のテスト', () => {
  const controller = new ProgressUpdateController();

  // 初回は更新すべき
  assertEquals(controller.shouldUpdate(), true);

  // 更新をマーク
  controller.markUpdated();

  // 直後は更新すべきでない
  assertEquals(controller.shouldUpdate(), false);

  // 次回更新までの残り時間をチェック
  const timeUntilNext = controller.getTimeUntilNextUpdate();
  assertEquals(timeUntilNext > 0, true);
  assertEquals(timeUntilNext <= 5000, true);
});
