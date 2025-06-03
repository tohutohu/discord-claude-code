// 依存関係の一元管理

// Cliffy - コマンドラインフレームワーク
export {
  Command,
  CompletionsCommand,
  HelpCommand,
} from 'https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts';
export type { ArgumentValue } from 'https://deno.land/x/cliffy@v1.0.0-rc.4/command/mod.ts';

// React & Ink - ターミナルUI
export { default as React } from 'npm:react@18.3.1';
export type { FC, ReactElement } from 'npm:react@18.3.1';
export { Box, render, Text, useApp, useInput, useStdout } from 'npm:ink@5.0.1';
export type { BoxProps, Instance, TextProps } from 'npm:ink@5.0.1';

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
  assertStringIncludes,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
export { delay } from 'https://deno.land/std@0.224.0/async/delay.ts';

// Discordeno - Discord Bot API (v21.0.0)
// Note: v21 uses @discordeno/bot as the main package
export { createBot } from 'npm:@discordeno/bot@21.0.0';
export type { Bot, Interaction } from 'npm:@discordeno/bot@21.0.0';

// Discord API types from @discordeno/types
export {
  ApplicationCommandOptionTypes,
  ApplicationCommandTypes,
  InteractionResponseTypes,
  InteractionTypes,
  MessageComponentTypes,
} from 'npm:@discordeno/types@21.0.0';

export type {
  CreateApplicationCommand,
  DiscordApplicationCommandOption,
  DiscordApplicationCommandOptionChoice,
  DiscordEmbed,
  DiscordInteraction,
  DiscordMessage,
} from 'npm:@discordeno/types@21.0.0';

// その他のユーティリティ
export { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';
