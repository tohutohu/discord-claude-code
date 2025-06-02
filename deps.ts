/**
 * 外部依存関係の一元管理
 * すべての外部モジュールはここからインポートする
 */

// Cliffy - CLIフレームワーク
export { Command } from '@cliffy/command';
export { Confirm, Input, List, prompt, Select } from '@cliffy/prompt';
export { Table } from '@cliffy/table';

// deno_tui - TUIフレームワーク
export * as tui from '@deno/tui';

// Deno標準ライブラリ
export * as colors from 'https://deno.land/std@0.224.0/fmt/colors.ts';
export * as datetime from '@std/datetime';
export * as yaml from '@std/yaml';
export * as path from '@std/path';
export * as fs from '@std/fs';
export * as async from '@std/async';
export { assert, assertEquals, assertExists, assertRejects, assertThrows } from '@std/assert';

// Discordeno - Discord APIライブラリ（将来実装予定）
// export * as discord from '@discordeno/bot';
// export * as discordRest from '@discordeno/rest';
// export * as discordUtils from '@discordeno/utils';

// 型定義のエクスポート
export type { CommandArguments, CommandOptions } from '@cliffy/command';
export type { PromptOptions } from '@cliffy/prompt';
