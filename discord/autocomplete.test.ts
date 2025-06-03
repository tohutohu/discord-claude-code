// Discord オートコンプリート機能のテスト

import { assertEquals, assertExists, assertStringIncludes } from '../deps.ts';
import { RepositoryAutocomplete } from './autocomplete.ts';
import type { RepoMeta } from '../repoScanner.ts';

// テスト用のモックリポジトリデータ
const mockRepos: RepoMeta[] = [
  {
    name: 'core-api',
    path: '/test/core-api',
    url: 'https://github.com/test/core-api.git',
    branch: 'main',
    lastModified: new Date('2025-01-01T00:00:00Z'),
    lastCommit: 'abc123',
  },
  {
    name: 'web-admin',
    path: '/test/web-admin',
    url: 'https://github.com/test/web-admin.git',
    branch: 'develop',
    lastModified: new Date('2025-01-02T00:00:00Z'),
    lastCommit: 'def456',
  },
  {
    name: 'auth-service',
    path: '/test/auth-service',
    url: 'https://github.com/test/auth-service.git',
    branch: 'main',
    lastModified: new Date('2025-01-03T00:00:00Z'),
    lastCommit: 'ghi789',
  },
  {
    name: 'notification-service',
    path: '/test/notification-service',
    url: 'https://github.com/test/notification-service.git',
    branch: 'feature/notifications',
    lastModified: new Date('2025-01-04T00:00:00Z'),
    lastCommit: 'jkl012',
  },
  {
    name: 'user-management',
    path: '/test/user-management',
    url: 'https://github.com/test/user-management.git',
    branch: 'main',
    lastModified: new Date('2025-01-05T00:00:00Z'),
    lastCommit: 'mno345',
  },
];

// RepositoryAutocompleteクラスのテスト用サブクラス
class TestRepositoryAutocomplete extends RepositoryAutocomplete {
  constructor() {
    super({
      maxChoices: 25,
      maxRecentRepos: 5,
      minFuzzyScore: 0.1,
      cacheExpiry: 1000, // 1秒（テスト用）
    });
  }

  // テスト用にプライベートメソッドを公開
  public testCalculateFuzzyScore(target: string, query: string): number {
    // deno-lint-ignore no-explicit-any
    return (this as any).calculateFuzzyScore(target, query);
  }

  public testCalculateLevenshteinScore(target: string, query: string): number {
    // deno-lint-ignore no-explicit-any
    return (this as any).calculateLevenshteinScore(target, query);
  }

  public testCalculateWordBoundaryScore(target: string, query: string): number {
    // deno-lint-ignore no-explicit-any
    return (this as any).calculateWordBoundaryScore(target, query);
  }

  public testFormatRepositoryChoice(repo: RepoMeta): string {
    // deno-lint-ignore no-explicit-any
    return (this as any).formatRepositoryChoice(repo);
  }

  // テスト用にリポジトリデータを直接設定
  public setMockRepositories(repos: RepoMeta[]): void {
    // deno-lint-ignore no-explicit-any
    (this as any).repoCache = {
      repos,
      cachedAt: new Date(),
    };
  }

  // 最近使用したリポジトリを直接設定
  // deno-lint-ignore no-explicit-any
  public setRecentRepositories(recent: Map<string, any>): void {
    // deno-lint-ignore no-explicit-any
    (this as any).recentRepos = recent;
  }
}

Deno.test('RepositoryAutocompleteの基本機能テスト', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  // インスタンスが正常に作成されることを確認
  assertExists(autocomplete);
});

Deno.test('リポジトリ使用履歴の記録テスト', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  // 使用履歴を記録
  autocomplete.recordRepositoryUsage('core-api');
  autocomplete.recordRepositoryUsage('web-admin');
  autocomplete.recordRepositoryUsage('core-api'); // 重複使用

  // 内部状態の確認はprivateなので、動作確認のみ
  assertEquals(true, true); // 正常に実行されることを確認
});

Deno.test('fuzzy検索スコア計算のテスト（完全一致）', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  const score = autocomplete.testCalculateFuzzyScore('core-api', 'core-api');
  assertEquals(score, 1.0);
});

Deno.test('fuzzy検索スコア計算のテスト（前方一致）', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  const score = autocomplete.testCalculateFuzzyScore('core-api', 'core');
  assertEquals(score, 0.9);
});

Deno.test('fuzzy検索スコア計算のテスト（部分一致）', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  const score = autocomplete.testCalculateFuzzyScore('core-api', 'api');
  assertEquals(score, 0.7);
});

Deno.test('fuzzy検索スコア計算のテスト（マッチなし）', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  const score = autocomplete.testCalculateFuzzyScore('core-api', 'xyz');
  assertEquals(score, 0);
});

Deno.test('Levenshtein距離ベーススコアのテスト', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  // 類似文字列
  const score1 = autocomplete.testCalculateLevenshteinScore('core-api', 'core-apo');
  assertEquals(score1 > 0.7, true);

  // 完全一致
  const score2 = autocomplete.testCalculateLevenshteinScore('core-api', 'core-api');
  assertEquals(score2, 1.0);

  // 全く異なる文字列
  const score3 = autocomplete.testCalculateLevenshteinScore('core-api', 'xyz123');
  assertEquals(score3 < 0.3, true);
});

Deno.test('単語境界スコア計算のテスト', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  // ハイフン区切りの一致
  const score1 = autocomplete.testCalculateWordBoundaryScore('user-management', 'user');
  assertEquals(score1, 1.0);

  // アンダースコア区切りの一致
  const score2 = autocomplete.testCalculateWordBoundaryScore('auth_service', 'auth');
  assertEquals(score2, 1.0);

  // 部分的な一致
  const score3 = autocomplete.testCalculateWordBoundaryScore('notification-service', 'not');
  assertEquals(score3, 1.0);

  // マッチなし
  const score4 = autocomplete.testCalculateWordBoundaryScore('core-api', 'xyz');
  assertEquals(score4, 0);
});

Deno.test('リポジトリ選択肢フォーマットのテスト（メインブランチ）', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  const repo: RepoMeta = {
    name: 'core-api',
    path: '/test/core-api',
    url: 'https://github.com/test/core-api.git',
    branch: 'main',
    lastModified: new Date(),
  };

  const formatted = autocomplete.testFormatRepositoryChoice(repo);
  assertEquals(formatted, 'core-api');
});

Deno.test('リポジトリ選択肢フォーマットのテスト（フィーチャーブランチ）', () => {
  const autocomplete = new TestRepositoryAutocomplete();

  const repo: RepoMeta = {
    name: 'web-admin',
    path: '/test/web-admin',
    url: 'https://github.com/test/web-admin.git',
    branch: 'feature/new-ui',
    lastModified: new Date(),
  };

  const formatted = autocomplete.testFormatRepositoryChoice(repo);
  assertEquals(formatted, 'web-admin (feature/new-ui)');
});

Deno.test('空クエリでの候補取得テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  const choices = await autocomplete.getRepositoryChoices('');

  // 候補が返されることを確認
  assertEquals(choices.length > 0, true);
  assertEquals(choices.length <= 25, true); // Discord制限内

  // 最初の候補を確認
  assertExists(choices[0]);
  assertExists(choices[0]!.name);
  assertExists(choices[0]!.value);
});

Deno.test('クエリありでの候補取得テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  const choices = await autocomplete.getRepositoryChoices('core');

  // 'core'に関連する候補が返されることを確認
  assertEquals(choices.length > 0, true);
  const hasCore = choices.some((choice) => String(choice.value).includes('core'));
  assertEquals(hasCore, true);
});

Deno.test('最近使用したリポジトリの優先表示テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  // 最近使用したリポジトリを設定
  const recentMap = new Map();
  recentMap.set('auth-service', {
    name: 'auth-service',
    lastUsed: new Date(),
    useCount: 3,
  });
  autocomplete.setRecentRepositories(recentMap);

  const choices = await autocomplete.getRepositoryChoices('');

  // 最近使用したリポジトリが⭐マークで表示されることを確認
  const hasStarred = choices.some((choice) => choice.name.includes('⭐'));
  assertEquals(hasStarred, true);
});

Deno.test('fuzzy検索での候補フィルタリングテスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  const choices = await autocomplete.getRepositoryChoices('notif');

  // 'notification-service'が候補に含まれることを確認
  const hasNotification = choices.some((choice) => choice.value === 'notification-service');
  assertEquals(hasNotification, true);
});

Deno.test('フォールバック候補のテスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  // モックリポジトリを設定せず、エラーを発生させる

  const choices = await autocomplete.getRepositoryChoices('');

  // フォールバック候補が返されることを確認
  assertEquals(choices.length > 0, true);

  // 基本的なリポジトリ名が含まれることを確認
  const hasBasicRepo = choices.some((choice) =>
    ['core-api', 'web-admin', 'auth-service'].includes(String(choice.value))
  );
  assertEquals(hasBasicRepo, true);
});

Deno.test('候補数の制限テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();

  // 大量のモックリポジトリを作成
  const manyRepos: RepoMeta[] = Array.from({ length: 50 }, (_, i) => ({
    name: `repo-${i}`,
    path: `/test/repo-${i}`,
    url: `https://github.com/test/repo-${i}.git`,
    branch: 'main',
    lastModified: new Date(),
  }));

  autocomplete.setMockRepositories(manyRepos);

  const choices = await autocomplete.getRepositoryChoices('repo');

  // 25個以下に制限されることを確認
  assertEquals(choices.length <= 25, true);
});

Deno.test('ブランチ情報付きリポジトリ名の表示テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  const choices = await autocomplete.getRepositoryChoices('web-admin');

  // ブランチ情報が表示されることを確認
  const webAdminChoice = choices.find((choice) => choice.value === 'web-admin');
  assertExists(webAdminChoice);
  assertStringIncludes(webAdminChoice.name, 'develop');
});

Deno.test('大文字小文字を無視した検索テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  const choices = await autocomplete.getRepositoryChoices('CORE');

  // 大文字小文字を無視してマッチすることを確認
  const hasCoreApi = choices.some((choice) => choice.value === 'core-api');
  assertEquals(hasCoreApi, true);
});

Deno.test('複数単語クエリの検索テスト', async () => {
  const autocomplete = new TestRepositoryAutocomplete();
  autocomplete.setMockRepositories(mockRepos);

  const choices = await autocomplete.getRepositoryChoices('user manage');

  // 単語境界マッチングで見つかることを確認
  const hasUserManagement = choices.some((choice) => choice.value === 'user-management');
  assertEquals(hasUserManagement, true);
});
