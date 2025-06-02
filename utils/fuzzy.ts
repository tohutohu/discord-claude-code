/**
 * Fuzzy検索ユーティリティ
 */

import { assert, assertEquals } from '../deps.ts';

/**
 * Fuzzy検索を実行する
 * @param items 検索対象の配列
 * @param query 検索クエリ
 * @param options オプション
 * @returns マッチした項目とスコアの配列
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  options?: {
    /** 項目から文字列を取得する関数 */
    getText?: (item: T) => string;
    /** 大文字小文字を区別するか */
    caseSensitive?: boolean;
    /** 最小スコア（0-1） */
    minScore?: number;
  },
): Array<{ item: T; score: number }> {
  const {
    getText = (item) => String(item),
    caseSensitive = false,
    minScore = 0,
  } = options || {};

  if (!query) {
    return items.map((item) => ({ item, score: 1 }));
  }

  const normalizedQuery = caseSensitive ? query : query.toLowerCase();
  const results: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const text = getText(item);
    const normalizedText = caseSensitive ? text : text.toLowerCase();
    const score = calculateScore(normalizedText, normalizedQuery);

    if (score >= minScore) {
      results.push({ item, score });
    }
  }

  // スコアの高い順にソート
  return results.sort((a, b) => b.score - a.score);
}

/**
 * 文字列のマッチスコアを計算する
 * @param text 対象文字列
 * @param query 検索クエリ
 * @returns スコア（0-1）
 */
function calculateScore(text: string, query: string): number {
  // 完全一致
  if (text === query) {
    return 1;
  }

  // 前方一致
  if (text.startsWith(query)) {
    return 0.9;
  }

  // 連続した文字のマッチ
  let score = 0;
  let queryIndex = 0;
  let prevMatchIndex = -1;
  let consecutiveMatches = 0;

  for (let i = 0; i < text.length && queryIndex < query.length; i++) {
    if (text[i] === query[queryIndex]) {
      // 連続したマッチはボーナス
      if (prevMatchIndex === i - 1) {
        consecutiveMatches++;
        score += 0.1 + (0.05 * consecutiveMatches);
      } else {
        consecutiveMatches = 0;
        score += 0.1;
      }

      // 単語の先頭でのマッチはボーナス
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '-' || text[i - 1] === '_') {
        score += 0.1;
      }

      prevMatchIndex = i;
      queryIndex++;
    }
  }

  // すべての文字がマッチした場合
  if (queryIndex === query.length) {
    // 文字列の長さに基づいてスコアを調整
    const lengthPenalty = Math.max(0, 1 - (text.length - query.length) * 0.01);
    return Math.min(1, score * lengthPenalty);
  }

  return 0;
}

/**
 * 最近使用した項目を優先してソートする
 * @param items 項目とスコアの配列
 * @param recentItems 最近使用した項目のリスト
 * @param getKey 項目からキーを取得する関数
 * @returns ソートされた配列
 */
export function sortByRecency<T>(
  items: Array<{ item: T; score: number }>,
  recentItems: string[],
  getKey: (item: T) => string,
): Array<{ item: T; score: number }> {
  return items.sort((a, b) => {
    // まずスコアで比較
    const scoreDiff = b.score - a.score;
    if (Math.abs(scoreDiff) > 0.1) {
      return scoreDiff;
    }

    // スコアが近い場合は最近使用した順
    const aKey = getKey(a.item);
    const bKey = getKey(b.item);
    const aIndex = recentItems.indexOf(aKey);
    const bIndex = recentItems.indexOf(bKey);

    // 両方とも最近使用していない
    if (aIndex === -1 && bIndex === -1) {
      return scoreDiff;
    }

    // 片方だけ最近使用
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;

    // 両方とも最近使用（インデックスが小さい方が最近）
    return aIndex - bIndex;
  });
}

// テストコード
Deno.test('fuzzy検索の基本動作', () => {
  const items = ['core-api', 'web-admin', 'auth-service', 'payment-gateway'];

  // 前方一致
  const results1 = fuzzySearch(items, 'core');
  assertEquals(results1[0].item, 'core-api');
  assert(results1[0].score > 0.8);

  // 部分一致
  const results2 = fuzzySearch(items, 'api');
  assertEquals(results2[0].item, 'core-api');

  // 複数文字のマッチ
  const results3 = fuzzySearch(items, 'wa');
  assert(results3.some((r) => r.item === 'web-admin'));
  assert(results3.some((r) => r.item === 'payment-gateway'));
});

Deno.test('最近使用した項目の優先', () => {
  const items = [
    { item: 'repo-a', score: 0.8 },
    { item: 'repo-b', score: 0.8 },
    { item: 'repo-c', score: 0.8 },
  ];

  const recent = ['repo-c', 'repo-a'];
  const sorted = sortByRecency(items, recent, (item) => item);

  // repo-c が最初に来る
  assertEquals(sorted[0].item, 'repo-c');
  assertEquals(sorted[1].item, 'repo-a');
  assertEquals(sorted[2].item, 'repo-b');
});
