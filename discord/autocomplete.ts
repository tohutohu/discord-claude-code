// Discord スラッシュコマンドのオートコンプリート機能
// fuzzy検索と最近使用したリポジトリの優先表示

import { defaultRepoScanner } from '../repoScanner.ts';
import type { DiscordApplicationCommandOptionChoice } from '../deps.ts';
import type { RepoMeta } from '../repoScanner.ts';

/**
 * 最近使用したリポジトリの情報
 */
interface RecentRepository {
  /** リポジトリ名 */
  name: string;
  /** 最後に使用した日時 */
  lastUsed: Date;
  /** 使用回数 */
  useCount: number;
}

/**
 * オートコンプリートの設定
 */
interface AutocompleteOptions {
  /** 最大候補数 */
  maxChoices?: number;
  /** 最近使用したリポジトリの最大保持数 */
  maxRecentRepos?: number;
  /** fuzzy検索の最小スコア（0-1） */
  minFuzzyScore?: number;
  /** キャッシュの有効期限（ミリ秒） */
  cacheExpiry?: number;
}

/**
 * リポジトリオートコンプリート管理クラス
 */
export class RepositoryAutocomplete {
  private recentRepos: Map<string, RecentRepository> = new Map();
  private repoCache: { repos: RepoMeta[]; cachedAt: Date } | null = null;
  private options: Required<AutocompleteOptions>;

  constructor(options: AutocompleteOptions = {}) {
    this.options = {
      maxChoices: 25, // Discord の制限
      maxRecentRepos: 10,
      minFuzzyScore: 0.1,
      cacheExpiry: 5 * 60 * 1000, // 5分
      ...options,
    };
  }

  /**
   * リポジトリ候補を取得（オートコンプリート用）
   * @param query ユーザーの入力文字列
   * @param rootDir スキャン対象のルートディレクトリ
   * @returns オートコンプリートの候補
   */
  async getRepositoryChoices(
    query?: string,
    rootDir?: string,
  ): Promise<DiscordApplicationCommandOptionChoice[]> {
    try {
      // リポジトリ一覧を取得（キャッシュ付き）
      const allRepos = await this.getRepositories(rootDir);

      // クエリが空の場合は最近使用したリポジトリを優先表示
      if (!query || query.trim() === '') {
        const recentChoices = this.getRecentRepositoryChoices(allRepos);

        // リポジトリが見つからない場合はフォールバックを使用
        if (recentChoices.length === 0) {
          return this.getFallbackChoices();
        }

        return recentChoices;
      }

      // fuzzy検索でフィルタリング
      const filteredRepos = this.fuzzyFilter(allRepos, query.trim());

      // 最近使用したリポジトリにスコアボーナスを追加
      const scoredRepos = this.applyRecentBoost(filteredRepos);

      // スコア順でソートして上位を返す
      const searchResults = scoredRepos
        .sort((a, b) => b.score - a.score)
        .slice(0, this.options.maxChoices)
        .map((item) => ({
          name: this.formatRepositoryChoice(item.repo),
          value: item.repo.name,
        }));

      // 検索結果が空の場合はフォールバックを使用
      if (searchResults.length === 0) {
        return this.getFallbackChoices(query);
      }

      return searchResults;
    } catch (error) {
      console.error('リポジトリ候補取得エラー:', error);

      // エラー時はフォールバック候補を返す
      return this.getFallbackChoices(query);
    }
  }

  /**
   * リポジトリ使用履歴を記録
   * @param repoName 使用したリポジトリ名
   */
  recordRepositoryUsage(repoName: string): void {
    const existing = this.recentRepos.get(repoName);

    if (existing) {
      // 既存のリポジトリの使用回数と日時を更新
      existing.lastUsed = new Date();
      existing.useCount += 1;
    } else {
      // 新規リポジトリを追加
      this.recentRepos.set(repoName, {
        name: repoName,
        lastUsed: new Date(),
        useCount: 1,
      });
    }

    // 最大保持数を超えた場合は古いものを削除
    this.cleanupRecentRepos();
  }

  /**
   * リポジトリ一覧を取得（キャッシュ付き）
   * @param rootDir スキャン対象のルートディレクトリ
   * @returns リポジトリメタ情報の配列
   */
  private async getRepositories(rootDir?: string): Promise<RepoMeta[]> {
    // キャッシュの有効性チェック
    if (this.repoCache && this.isCacheValid()) {
      return this.repoCache.repos;
    }

    try {
      // リポジトリスキャンを実行
      const scanResult = await defaultRepoScanner.scanRepos(
        rootDir || './repos',
        {
          maxDepth: 2,
          concurrency: 5,
          timeout: 10000, // 10秒でタイムアウト
        },
      );

      // キャッシュを更新
      this.repoCache = {
        repos: scanResult.repositories,
        cachedAt: new Date(),
      };

      return scanResult.repositories;
    } catch (error) {
      console.error('リポジトリスキャンエラー:', error);

      // キャッシュがある場合は古いキャッシュを返す
      if (this.repoCache) {
        return this.repoCache.repos;
      }

      return [];
    }
  }

  /**
   * キャッシュの有効性をチェック
   * @returns キャッシュが有効な場合はtrue
   */
  private isCacheValid(): boolean {
    if (!this.repoCache) {
      return false;
    }

    const now = new Date();
    const cacheAge = now.getTime() - this.repoCache.cachedAt.getTime();

    return cacheAge < this.options.cacheExpiry;
  }

  /**
   * 最近使用したリポジトリの候補を取得
   * @param allRepos 全リポジトリ一覧
   * @returns オートコンプリートの候補
   */
  private getRecentRepositoryChoices(
    allRepos: RepoMeta[],
  ): DiscordApplicationCommandOptionChoice[] {
    const choices: DiscordApplicationCommandOptionChoice[] = [];

    // 最近使用したリポジトリを優先して追加
    const recentRepoNames = Array.from(this.recentRepos.values())
      .sort((a, b) => {
        // 使用回数と最終使用日時でソート
        const scoreA = a.useCount + (a.lastUsed.getTime() / 1000000);
        const scoreB = b.useCount + (b.lastUsed.getTime() / 1000000);
        return scoreB - scoreA;
      })
      .map((repo) => repo.name);

    // 最近使用したリポジトリを追加
    for (const repoName of recentRepoNames) {
      const repo = allRepos.find((r) => r.name === repoName);
      if (repo && choices.length < this.options.maxChoices) {
        choices.push({
          name: `⭐ ${this.formatRepositoryChoice(repo)}`,
          value: repo.name,
        });
      }
    }

    // 残りの枠を他のリポジトリで埋める
    const recentNames = new Set(recentRepoNames);
    for (const repo of allRepos) {
      if (!recentNames.has(repo.name) && choices.length < this.options.maxChoices) {
        choices.push({
          name: this.formatRepositoryChoice(repo),
          value: repo.name,
        });
      }
    }

    return choices;
  }

  /**
   * fuzzy検索でリポジトリをフィルタリング
   * @param repos 検索対象のリポジトリ一覧
   * @param query 検索クエリ
   * @returns スコア付きリポジトリの配列
   */
  private fuzzyFilter(
    repos: RepoMeta[],
    query: string,
  ): Array<{ repo: RepoMeta; score: number }> {
    const normalizedQuery = query.toLowerCase();
    const results: Array<{ repo: RepoMeta; score: number }> = [];

    for (const repo of repos) {
      const score = this.calculateFuzzyScore(repo.name.toLowerCase(), normalizedQuery);

      if (score >= this.options.minFuzzyScore) {
        results.push({ repo, score });
      }
    }

    return results;
  }

  /**
   * fuzzy検索のスコアを計算
   * @param target 検索対象の文字列
   * @param query 検索クエリ
   * @returns マッチスコア（0-1）
   */
  private calculateFuzzyScore(target: string, query: string): number {
    // 完全一致
    if (target === query) {
      return 1.0;
    }

    // 前方一致
    if (target.startsWith(query)) {
      return 0.9;
    }

    // 部分一致
    if (target.includes(query)) {
      return 0.7;
    }

    // Levenshtein距離ベースのfuzzy検索
    const levenshteinScore = this.calculateLevenshteinScore(target, query);
    if (levenshteinScore > 0.6) {
      return levenshteinScore * 0.6; // 最大0.6点
    }

    // 単語境界での一致（ハイフン、アンダースコアで分割）
    const wordBoundaryScore = this.calculateWordBoundaryScore(target, query);
    if (wordBoundaryScore > 0) {
      return wordBoundaryScore * 0.5; // 最大0.5点
    }

    return 0;
  }

  /**
   * Levenshtein距離ベースのスコアを計算
   * @param target 対象文字列
   * @param query クエリ文字列
   * @returns 類似度スコア（0-1）
   */
  private calculateLevenshteinScore(target: string, query: string): number {
    const distance = this.levenshteinDistance(target, query);
    const maxLength = Math.max(target.length, query.length);

    return 1 - (distance / maxLength);
  }

  /**
   * Levenshtein距離を計算
   * @param str1 文字列1
   * @param str2 文字列2
   * @returns Levenshtein距離
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = Array(str2.length + 1).fill(null).map(() =>
      Array(str1.length + 1).fill(0)
    );

    for (let i = 0; i <= str1.length; i++) {
      matrix[0]![i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j]![0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j]![i] = Math.min(
          matrix[j]![i - 1]! + 1, // deletion
          matrix[j - 1]![i]! + 1, // insertion
          matrix[j - 1]![i - 1]! + indicator, // substitution
        );
      }
    }

    return matrix[str2.length]![str1.length]!;
  }

  /**
   * 単語境界での一致スコアを計算
   * @param target 対象文字列
   * @param query クエリ文字列
   * @returns マッチスコア（0-1）
   */
  private calculateWordBoundaryScore(target: string, query: string): number {
    const targetWords = target.split(/[-_]/);
    const queryWords = query.split(/[-_]/);

    let matchCount = 0;
    for (const queryWord of queryWords) {
      for (const targetWord of targetWords) {
        if (targetWord.startsWith(queryWord)) {
          matchCount++;
          break;
        }
      }
    }

    return matchCount / queryWords.length;
  }

  /**
   * 最近使用したリポジトリにスコアボーナスを適用
   * @param scoredRepos スコア付きリポジトリの配列
   * @returns ボーナス適用後のスコア付きリポジトリの配列
   */
  private applyRecentBoost(
    scoredRepos: Array<{ repo: RepoMeta; score: number }>,
  ): Array<{ repo: RepoMeta; score: number }> {
    return scoredRepos.map((item) => {
      const recent = this.recentRepos.get(item.repo.name);
      if (recent) {
        // 最近使用したリポジトリには使用回数と最新性に基づくボーナスを追加
        const recencyBonus = this.calculateRecencyBonus(recent);
        const usageBonus = Math.min(recent.useCount * 0.1, 0.3); // 最大0.3点

        return {
          ...item,
          score: Math.min(item.score + recencyBonus + usageBonus, 1.0),
        };
      }

      return item;
    });
  }

  /**
   * 最新性ボーナスを計算
   * @param recent 最近使用したリポジトリ情報
   * @returns 最新性ボーナス（0-0.2）
   */
  private calculateRecencyBonus(recent: RecentRepository): number {
    const now = new Date();
    const hoursSinceLastUse = (now.getTime() - recent.lastUsed.getTime()) / (1000 * 60 * 60);

    // 24時間以内: 0.2点, 1週間以内: 0.1点, それ以降: 0点
    if (hoursSinceLastUse < 24) {
      return 0.2;
    } else if (hoursSinceLastUse < 168) { // 7日 * 24時間
      return 0.1;
    }

    return 0;
  }

  /**
   * リポジトリ選択肢の表示名をフォーマット
   * @param repo リポジトリメタ情報
   * @returns フォーマットされた表示名
   */
  private formatRepositoryChoice(repo: RepoMeta): string {
    // ブランチ情報があれば表示
    if (repo.branch && repo.branch !== 'main' && repo.branch !== 'master') {
      return `${repo.name} (${repo.branch})`;
    }

    return repo.name;
  }

  /**
   * エラー時のフォールバック候補を取得
   * @param query ユーザーの入力クエリ
   * @returns フォールバック候補
   */
  private getFallbackChoices(query?: string): DiscordApplicationCommandOptionChoice[] {
    const fallbackRepos = [
      'core-api',
      'web-admin',
      'auth-service',
      'notification-service',
      'user-service',
    ];

    // クエリがある場合は簡易フィルタリング
    const filteredRepos = query
      ? fallbackRepos.filter((repo) => repo.toLowerCase().includes(query.toLowerCase()))
      : fallbackRepos;

    return filteredRepos.slice(0, this.options.maxChoices).map((name) => ({
      name,
      value: name,
    }));
  }

  /**
   * 古い最近使用履歴をクリーンアップ
   */
  private cleanupRecentRepos(): void {
    const recentArray = Array.from(this.recentRepos.values());

    // 最大数を超えている場合
    if (recentArray.length > this.options.maxRecentRepos) {
      // 最終使用日時と使用回数でソートして古いものを削除
      const sortedRepos = recentArray.sort((a, b) => {
        const scoreA = a.useCount + (a.lastUsed.getTime() / 1000000);
        const scoreB = b.useCount + (b.lastUsed.getTime() / 1000000);
        return scoreA - scoreB; // 昇順（古い順）
      });

      const toRemove = sortedRepos.slice(0, recentArray.length - this.options.maxRecentRepos);
      for (const repo of toRemove) {
        this.recentRepos.delete(repo.name);
      }
    }

    // 古すぎる履歴を削除（30日以上前）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    for (const [name, repo] of this.recentRepos.entries()) {
      if (repo.lastUsed < thirtyDaysAgo) {
        this.recentRepos.delete(name);
      }
    }
  }
}

/**
 * デフォルトのリポジトリオートコンプリートインスタンス
 */
export const defaultRepositoryAutocomplete = new RepositoryAutocomplete();
