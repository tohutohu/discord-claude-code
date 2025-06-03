/**
 * Discord コンポーネント型定義のテスト
 */

import { assertEquals, assertExists } from '../deps.ts';
import {
  ActionRow,
  ButtonComponent,
  ButtonStyle,
  ComponentRow,
  ConfigData,
  DiscordEmbed,
  ModalComponent,
  SelectMenuComponent,
  TextInputStyle,
} from './discord-components.ts';

Deno.test('ButtonStyle enum の値を確認', () => {
  assertEquals(ButtonStyle.Primary, 1);
  assertEquals(ButtonStyle.Secondary, 2);
  assertEquals(ButtonStyle.Success, 3);
  assertEquals(ButtonStyle.Danger, 4);
  assertEquals(ButtonStyle.Link, 5);
});

Deno.test('TextInputStyle enum の値を確認', () => {
  assertEquals(TextInputStyle.Short, 1);
  assertEquals(TextInputStyle.Paragraph, 2);
});

Deno.test('ButtonComponent 型の構造確認', () => {
  const button: ButtonComponent = {
    type: 2,
    style: ButtonStyle.Primary,
    label: 'テストボタン',
    custom_id: 'test_button',
    disabled: false,
  };

  assertEquals(button.type, 2);
  assertEquals(button.style, ButtonStyle.Primary);
  assertEquals(button.label, 'テストボタン');
  assertEquals(button.custom_id, 'test_button');
  assertEquals(button.disabled, false);
});

Deno.test('ActionRow 型の構造確認', () => {
  const actionRow: ActionRow = {
    type: 1,
    components: [
      {
        type: 2,
        style: ButtonStyle.Secondary,
        label: 'ボタン1',
        custom_id: 'btn1',
      },
    ],
  };

  assertEquals(actionRow.type, 1);
  assertEquals(actionRow.components.length, 1);
});

Deno.test('DiscordEmbed 型の構造確認', () => {
  const embed: DiscordEmbed = {
    title: 'テストEmbed',
    description: 'これはテストです',
    color: 0x0099ff,
    fields: [
      {
        name: 'フィールド1',
        value: '値1',
        inline: true,
      },
    ],
    footer: {
      text: 'フッターテキスト',
    },
    timestamp: new Date().toISOString(),
  };

  assertEquals(embed.title, 'テストEmbed');
  assertEquals(embed.description, 'これはテストです');
  assertEquals(embed.color, 0x0099ff);
  assertExists(embed.fields);
  assertEquals(embed.fields.length, 1);
  assertEquals(embed.fields[0]?.name, 'フィールド1');
  assertExists(embed.footer);
  assertEquals(embed.footer.text, 'フッターテキスト');
  assertExists(embed.timestamp);
});

Deno.test('SelectMenuComponent 型の構造確認', () => {
  const selectMenu: SelectMenuComponent = {
    type: 3,
    custom_id: 'test_select',
    options: [
      {
        label: 'オプション1',
        value: 'opt1',
        description: '最初のオプション',
      },
      {
        label: 'オプション2',
        value: 'opt2',
        description: '二番目のオプション',
        default: true,
      },
    ],
    placeholder: '選択してください',
    min_values: 1,
    max_values: 1,
  };

  assertEquals(selectMenu.type, 3);
  assertEquals(selectMenu.custom_id, 'test_select');
  assertEquals(selectMenu.options.length, 2);
  assertEquals(selectMenu.options[0]?.label, 'オプション1');
  assertEquals(selectMenu.options[1]?.default, true);
  assertEquals(selectMenu.placeholder, '選択してください');
});

Deno.test('ModalComponent 型の構造確認', () => {
  const modal: ModalComponent = {
    title: 'テストModal',
    custom_id: 'test_modal',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: 'test_input',
            label: 'テスト入力',
            style: TextInputStyle.Short,
            min_length: 1,
            max_length: 100,
            required: true,
            placeholder: '何か入力してください',
          },
        ],
      },
    ],
  };

  assertEquals(modal.title, 'テストModal');
  assertEquals(modal.custom_id, 'test_modal');
  assertEquals(modal.components.length, 1);
  assertEquals(modal.components[0]?.type, 1);
  assertEquals(modal.components[0]?.components.length, 1);

  const textInput = modal.components[0]?.components[0];
  assertEquals(textInput?.type, 4);
  assertEquals(textInput?.custom_id, 'test_input');
  assertEquals(textInput?.style, TextInputStyle.Short);
});

Deno.test('ConfigData 型の構造確認', () => {
  const config: ConfigData = {
    rootDir: '/test/repos',
    parallel: {
      maxSessions: 5,
      queueTimeout: 300,
    },
    discord: {
      guildIds: ['123456789'],
      commandPrefix: '/test',
    },
    claude: {
      model: 'test-model',
      timeout: 600,
    },
    logging: {
      level: 'INFO',
      retentionDays: 7,
      maxFileSize: '10MB',
    },
    repositories: {
      'test-repo': 'https://github.com/test/repo',
    },
  };

  assertEquals(config.rootDir, '/test/repos');
  assertEquals(config.parallel.maxSessions, 5);
  assertEquals(config.discord.guildIds.length, 1);
  assertEquals(config.claude.model, 'test-model');
  assertEquals(config.logging.level, 'INFO');
  assertExists(config.repositories);
  assertEquals(config.repositories['test-repo'], 'https://github.com/test/repo');
});

Deno.test('ComponentRow 型の構造確認', () => {
  const componentRow: ComponentRow = {
    components: [
      {
        custom_id: 'component1',
        value: 'value1',
      },
      {
        custom_id: 'component2',
        value: 'value2',
      },
    ],
  };

  assertEquals(componentRow.components.length, 2);
  assertEquals(componentRow.components[0]?.custom_id, 'component1');
  assertEquals(componentRow.components[1]?.value, 'value2');
});

Deno.test('型定義のexport確認', () => {
  // 全ての型とenumがexportされていることを確認
  assertEquals(typeof ButtonStyle, 'object');
  assertEquals(typeof TextInputStyle, 'object');

  // enumの値が正しいことを確認
  assertEquals(Object.keys(ButtonStyle).length, 10); // enum値とキーの両方
  assertEquals(Object.keys(TextInputStyle).length, 4); // enum値とキーの両方
});
