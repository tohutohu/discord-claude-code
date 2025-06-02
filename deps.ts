// 依存関係の一元管理

// Cliffy - コマンドラインフレームワーク
export {
  Command,
  CompletionsCommand,
  HelpCommand,
} from 'https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts';
export type { ArgumentValue } from 'https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts';

// deno_tui - ターミナルUI
export {
  handleInput,
  handleKeyboardControls,
  handleMouseControls,
  Tui,
  View,
} from 'https://deno.land/x/tui@2.1.5/mod.ts';
export type { Component, Rectangle } from 'https://deno.land/x/tui@2.1.5/mod.ts';

// Deno標準ライブラリ
export {
  blue,
  bold,
  dim,
  gray,
  green,
  red,
  yellow,
} from 'https://deno.land/std@0.224.0/fmt/colors.ts';
export {
  parse as parseYaml,
  stringify as stringifyYaml,
} from 'https://deno.land/std@0.224.0/yaml/mod.ts';
export { ensureDir, exists } from 'https://deno.land/std@0.224.0/fs/mod.ts';
export { basename, dirname, join, resolve } from 'https://deno.land/std@0.224.0/path/mod.ts';
export { format } from 'https://deno.land/std@0.224.0/datetime/format.ts';
export {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
export { delay } from 'https://deno.land/std@0.224.0/async/delay.ts';

// Discordeno - 後でPR-3で詳細に実装
// 現在は型チェックエラーを避けるためコメントアウト
// export * as discord from 'https://deno.land/x/discordeno@18.0.1/mod.ts';

// その他のユーティリティ
export { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';
