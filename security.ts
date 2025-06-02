/**
 * セキュリティ機能の実装
 * @cli APIキー暗号化、Rate Limiting、入力サニタイゼーション
 */

import { logger } from './logger.ts';
import { Config } from './types/config.ts';

/** 暗号化されたデータ */
export interface EncryptedData {
  /** 暗号化されたデータ */
  data: string;
  /** 初期化ベクトル */
  iv: string;
  /** 認証タグ */
  tag: string;
  /** 暗号化アルゴリズム */
  algorithm: string;
}

/** Rate Limitエントリ */
interface RateLimitEntry {
  /** リクエスト回数 */
  count: number;
  /** ウィンドウ開始時刻 */
  windowStart: number;
  /** 最後のリクエスト時刻 */
  lastRequest: number;
}

/** Rate Limit設定 */
export interface RateLimitConfig {
  /** 時間ウィンドウ（秒） */
  windowSeconds: number;
  /** 最大リクエスト数 */
  maxRequests: number;
  /** ブロック時間（秒） */
  blockDuration?: number;
}

/** 入力検証ルール */
export interface ValidationRule {
  /** ルール名 */
  name: string;
  /** パターン */
  pattern: RegExp;
  /** エラーメッセージ */
  message: string;
}

/** サニタイゼーション結果 */
export interface SanitizationResult {
  /** サニタイズ済みの値 */
  value: string;
  /** 変更があったかどうか */
  changed: boolean;
  /** 検出された脅威 */
  threats: string[];
}

/**
 * 暗号化・復号化ユーティリティ
 */
export class CryptoManager {
  private masterKey?: CryptoKey;

  /**
   * マスターキーを初期化
   * @param password パスワード（省略時は環境変数から取得）
   */
  async initMasterKey(password?: string): Promise<void> {
    const keyMaterial = password || Deno.env.get('CLAUDE_MASTER_KEY') || 'default-key-change-me';

    // パスワードからキーを導出
    const encoder = new TextEncoder();
    const keyData = encoder.encode(keyMaterial);

    const importedKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );

    // AES-GCMキーを導出
    this.masterKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('claude-bot-salt'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      importedKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );

    logger.debug('暗号化マスターキーを初期化しました');
  }

  /**
   * データを暗号化
   * @param plaintext 平文
   * @returns 暗号化されたデータ
   */
  async encrypt(plaintext: string): Promise<EncryptedData> {
    if (!this.masterKey) {
      throw new Error('暗号化キーが初期化されていません');
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM推奨のIVサイズ

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.masterKey,
      data,
    );

    // 暗号化データとタグを分離
    const encryptedArray = new Uint8Array(encrypted);
    const ciphertext = encryptedArray.slice(0, -16);
    const tag = encryptedArray.slice(-16);

    return {
      data: btoa(String.fromCharCode(...ciphertext)),
      iv: btoa(String.fromCharCode(...iv)),
      tag: btoa(String.fromCharCode(...tag)),
      algorithm: 'AES-GCM',
    };
  }

  /**
   * データを復号化
   * @param encryptedData 暗号化されたデータ
   * @returns 復号化された平文
   */
  async decrypt(encryptedData: EncryptedData): Promise<string> {
    if (!this.masterKey) {
      throw new Error('暗号化キーが初期化されていません');
    }

    const data = Uint8Array.from(atob(encryptedData.data), (c) => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(encryptedData.iv), (c) => c.charCodeAt(0));
    const tag = Uint8Array.from(atob(encryptedData.tag), (c) => c.charCodeAt(0));

    // データとタグを結合
    const combined = new Uint8Array(data.length + tag.length);
    combined.set(data);
    combined.set(tag, data.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.masterKey,
      combined,
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }
}

/**
 * Rate Limiting管理
 */
export class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private configs = new Map<string, RateLimitConfig>();
  private cleanupInterval?: number;

  constructor() {
    // 5分ごとに古いエントリをクリーンアップ
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Rate Limit設定を追加
   * @param identifier 識別子
   * @param config 設定
   */
  addConfig(identifier: string, config: RateLimitConfig): void {
    this.configs.set(identifier, config);
    logger.debug(`Rate Limit設定追加: ${identifier}`, { config });
  }

  /**
   * リクエストの可否をチェック
   * @param identifier 識別子（ユーザーID、IPアドレス等）
   * @param category カテゴリ（省略時は'default'）
   * @returns 許可されるかどうか
   */
  checkLimit(identifier: string, category = 'default'): boolean {
    const key = `${category}:${identifier}`;
    const config = this.configs.get(category);

    if (!config) {
      // 設定がない場合は許可
      return true;
    }

    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry) {
      // 初回リクエスト
      this.limits.set(key, {
        count: 1,
        windowStart: now,
        lastRequest: now,
      });
      return true;
    }

    // ウィンドウの確認
    const windowMs = config.windowSeconds * 1000;
    if (now - entry.windowStart > windowMs) {
      // 新しいウィンドウ
      entry.count = 1;
      entry.windowStart = now;
      entry.lastRequest = now;
      return true;
    }

    // 制限チェック
    if (entry.count >= config.maxRequests) {
      logger.warn(`Rate Limit exceeded: ${key}`, {
        count: entry.count,
        maxRequests: config.maxRequests,
        identifier,
        category,
      });
      return false;
    }

    // カウント増加
    entry.count++;
    entry.lastRequest = now;
    return true;
  }

  /**
   * リクエスト統計を取得
   * @param identifier 識別子
   * @param category カテゴリ
   * @returns 統計情報
   */
  getStats(identifier: string, category = 'default'): {
    count: number;
    remaining: number;
    resetTime: Date;
  } | null {
    const key = `${category}:${identifier}`;
    const config = this.configs.get(category);
    const entry = this.limits.get(key);

    if (!config || !entry) {
      return null;
    }

    const windowMs = config.windowSeconds * 1000;
    const resetTime = new Date(entry.windowStart + windowMs);
    const remaining = Math.max(0, config.maxRequests - entry.count);

    return {
      count: entry.count,
      remaining,
      resetTime,
    };
  }

  /**
   * 古いエントリをクリーンアップ
   */
  private cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.limits) {
      // 24時間以上古いエントリを削除
      if (now - entry.lastRequest > 24 * 60 * 60 * 1000) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.limits.delete(key);
    }

    if (toDelete.length > 0) {
      logger.debug(`Rate Limitエントリクリーンアップ: ${toDelete.length}件`);
    }
  }

  /**
   * リソースをクリーンアップ
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

/**
 * 入力サニタイゼーション・バリデーション
 */
export class InputSanitizer {
  private validationRules: ValidationRule[] = [];

  constructor() {
    this.setupDefaultRules();
  }

  /**
   * バリデーションルールを追加
   * @param rule ルール
   */
  addRule(rule: ValidationRule): void {
    this.validationRules.push(rule);
  }

  /**
   * テキストをサニタイズ
   * @param input 入力テキスト
   * @returns サニタイズ結果
   */
  sanitizeText(input: string): SanitizationResult {
    let sanitized = input;
    const threats: string[] = [];
    let changed = false;

    // HTMLエスケープ
    const htmlEscaped = this.escapeHtml(sanitized);
    if (htmlEscaped !== sanitized) {
      sanitized = htmlEscaped;
      threats.push('HTML injection');
      changed = true;
    }

    // SQLインジェクション対策
    const sqlSafe = this.escapeSql(sanitized);
    if (sqlSafe !== sanitized) {
      sanitized = sqlSafe;
      threats.push('SQL injection');
      changed = true;
    }

    // スクリプトタグ削除
    const scriptSafe = this.removeScriptTags(sanitized);
    if (scriptSafe !== sanitized) {
      sanitized = scriptSafe;
      threats.push('Script injection');
      changed = true;
    }

    // 改行コード正規化
    const normalized = sanitized.replace(/\r\n|\r/g, '\n');
    if (normalized !== sanitized) {
      sanitized = normalized;
      changed = true;
    }

    return {
      value: sanitized,
      changed,
      threats,
    };
  }

  /**
   * 入力をバリデーション
   * @param input 入力値
   * @returns バリデーション結果
   */
  validate(input: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const rule of this.validationRules) {
      if (rule.pattern.test(input)) {
        errors.push(rule.message);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * ファイル名をサニタイズ
   * @param filename ファイル名
   * @returns サニタイズ済みファイル名
   */
  sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_') // 危険な文字を置換
      .replace(/^\.+/, '') // 先頭のドットを削除
      .replace(/\s+/g, '_') // 空白をアンダースコアに
      .substring(0, 255); // 長さ制限
  }

  /**
   * パスをサニタイズ（パストラバーサル対策）
   * @param path パス
   * @returns サニタイズ済みパス
   */
  sanitizePath(path: string): string {
    return path
      .replace(/\.\./g, '') // ディレクトリトラバーサル対策
      .replace(/\/+/g, '/') // 連続スラッシュを正規化
      .replace(/^\//, ''); // 先頭スラッシュを削除
  }

  /**
   * HTMLエスケープ
   * @param text テキスト
   * @returns エスケープ済みテキスト
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * SQLエスケープ
   * @param text テキスト
   * @returns エスケープ済みテキスト
   */
  private escapeSql(text: string): string {
    return text.replace(/'/g, "''");
  }

  /**
   * スクリプトタグを削除
   * @param text テキスト
   * @returns スクリプトタグ削除済みテキスト
   */
  private removeScriptTags(text: string): string {
    return text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }

  /**
   * デフォルトルールを設定
   */
  private setupDefaultRules(): void {
    this.addRule({
      name: 'script_injection',
      pattern: /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      message: 'スクリプトタグは許可されていません',
    });

    this.addRule({
      name: 'sql_injection',
      pattern:
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b.*\b(FROM|INTO|WHERE|SET|VALUES|TABLE)\b)/gi,
      message: 'SQLコマンドは許可されていません',
    });

    this.addRule({
      name: 'path_traversal',
      pattern: /\.\.[\/\\]/g,
      message: 'パストラバーサルは許可されていません',
    });

    this.addRule({
      name: 'command_injection',
      pattern: /[;&|`$(){}[\]]/g,
      message: 'コマンドインジェクション文字は許可されていません',
    });
  }
}

/**
 * セキュリティマネージャー
 * 全てのセキュリティ機能を統合管理
 */
export class SecurityManager {
  private crypto: CryptoManager;
  private rateLimiter: RateLimiter;
  private sanitizer: InputSanitizer;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.crypto = new CryptoManager();
    this.rateLimiter = new RateLimiter();
    this.sanitizer = new InputSanitizer();
    this.setupDefaultRateLimits();
  }

  /**
   * セキュリティマネージャーを初期化
   */
  async init(): Promise<void> {
    await this.crypto.initMasterKey();
    logger.info('セキュリティマネージャーを初期化しました');
  }

  /**
   * APIキーを暗号化して保存
   * @param key APIキー
   * @returns 暗号化されたデータ
   */
  async encryptApiKey(key: string): Promise<EncryptedData> {
    logger.debug('APIキーを暗号化します');
    return await this.crypto.encrypt(key);
  }

  /**
   * 暗号化されたAPIキーを復号化
   * @param encryptedData 暗号化されたデータ
   * @returns 復号化されたAPIキー
   */
  async decryptApiKey(encryptedData: EncryptedData): Promise<string> {
    logger.debug('APIキーを復号化します');
    return await this.crypto.decrypt(encryptedData);
  }

  /**
   * リクエストのRate Limitチェック
   * @param userId ユーザーID
   * @param action アクション
   * @returns 許可されるかどうか
   */
  checkRateLimit(userId: string, action = 'default'): boolean {
    return this.rateLimiter.checkLimit(userId, action);
  }

  /**
   * 入力をサニタイズ
   * @param input 入力
   * @returns サニタイズ結果
   */
  sanitizeInput(input: string): SanitizationResult {
    const result = this.sanitizer.sanitizeText(input);

    if (result.threats.length > 0) {
      logger.warn('セキュリティ脅威を検出', {
        threats: result.threats,
        originalLength: input.length,
        sanitizedLength: result.value.length,
      });
    }

    return result;
  }

  /**
   * ファイル名をサニタイズ
   * @param filename ファイル名
   * @returns サニタイズ済みファイル名
   */
  sanitizeFilename(filename: string): string {
    return this.sanitizer.sanitizeFilename(filename);
  }

  /**
   * Rate Limit統計を取得
   * @param userId ユーザーID
   * @param action アクション
   * @returns 統計情報
   */
  getRateLimitStats(userId: string, action = 'default') {
    return this.rateLimiter.getStats(userId, action);
  }

  /**
   * リソースをクリーンアップ
   */
  dispose(): void {
    this.rateLimiter.dispose();
  }

  /**
   * デフォルトのRate Limit設定
   */
  private setupDefaultRateLimits(): void {
    // Claude実行の制限
    this.rateLimiter.addConfig('claude_execution', {
      windowSeconds: 3600, // 1時間
      maxRequests: 10, // 10回まで
    });

    // Discord API制限
    this.rateLimiter.addConfig('discord_api', {
      windowSeconds: 60, // 1分
      maxRequests: 50, // 50回まで
    });

    // 一般的なAPI制限
    this.rateLimiter.addConfig('default', {
      windowSeconds: 60, // 1分
      maxRequests: 100, // 100回まで
    });
  }
}

// テスト @security
Deno.test('CryptoManager - 暗号化・復号化', async () => {
  const crypto = new CryptoManager();
  await crypto.initMasterKey('test-key');

  const plaintext = 'sk-1234567890abcdef1234567890abcdef';
  const encrypted = await crypto.encrypt(plaintext);
  const decrypted = await crypto.decrypt(encrypted);

  assertEquals(decrypted, plaintext);
  assertEquals(encrypted.algorithm, 'AES-GCM');
});

Deno.test('RateLimiter - 制限動作', () => {
  const limiter = new RateLimiter();
  limiter.addConfig('test', { windowSeconds: 60, maxRequests: 3 });

  // 3回まで許可
  assertEquals(limiter.checkLimit('user1', 'test'), true);
  assertEquals(limiter.checkLimit('user1', 'test'), true);
  assertEquals(limiter.checkLimit('user1', 'test'), true);

  // 4回目は拒否
  assertEquals(limiter.checkLimit('user1', 'test'), false);

  // 異なるユーザーは独立
  assertEquals(limiter.checkLimit('user2', 'test'), true);

  limiter.dispose();
});

Deno.test('InputSanitizer - HTMLエスケープ', () => {
  const sanitizer = new InputSanitizer();

  const result = sanitizer.sanitizeText('<script>alert("xss")</script>');

  assertEquals(result.changed, true);
  assertEquals(result.threats.includes('Script injection'), true);
  assertEquals(result.value.includes('<script>'), false);
});

Deno.test('InputSanitizer - ファイル名サニタイズ', () => {
  const sanitizer = new InputSanitizer();

  const dangerous = '../../../etc/passwd';
  const safe = sanitizer.sanitizeFilename(dangerous);

  assertEquals(safe, '___etc_passwd');
});

Deno.test('InputSanitizer - バリデーション', () => {
  const sanitizer = new InputSanitizer();

  const result = sanitizer.validate('SELECT * FROM users WHERE id = 1');

  assertEquals(result.valid, false);
  assertEquals(result.errors.length > 0, true);
});
