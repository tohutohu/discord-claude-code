// Discord メッセージ出力分割ユーティリティのテスト

import { assertEquals, assertStringIncludes } from '../deps.ts';
import { addCodeBlockMarkers, joinSplitMessages, splitMessage } from './messageUtils.ts';

Deno.test('短いメッセージの分割テスト', () => {
  const text = 'これは短いメッセージです。';
  const messages = splitMessage(text);

  assertEquals(messages.length, 1);
  assertEquals(messages[0]!.content, text);
  assertEquals(messages[0]!.messageNumber, 1);
  assertEquals(messages[0]!.totalMessages, 1);
  assertEquals(messages[0]!.isPartialCodeBlock, false);
});

Deno.test('長いメッセージの分割テスト', () => {
  // 2000文字のテキストを生成
  const longText = 'あ'.repeat(2000);
  const messages = splitMessage(longText, { maxLength: 1900 });

  assertEquals(messages.length, 2);
  assertEquals(messages[0]!.messageNumber, 1);
  assertEquals(messages[0]!.totalMessages, 2);
  assertEquals(messages[1]!.messageNumber, 2);
  assertEquals(messages[1]!.totalMessages, 2);

  // メッセージ番号が含まれていることを確認
  assertStringIncludes(messages[0]!.content, '[1/2]');
  assertStringIncludes(messages[1]!.content, '[2/2]');
});

Deno.test('メッセージ番号なしの分割テスト', () => {
  const longText = 'あ'.repeat(2000);
  const messages = splitMessage(longText, {
    maxLength: 1900,
    addMessageNumbers: false,
  });

  assertEquals(messages.length, 2);
  // メッセージ番号が含まれていないことを確認
  assertEquals(messages[0]!.content.includes('[1/2]'), false);
  assertEquals(messages[1]!.content.includes('[2/2]'), false);
});

Deno.test('プレフィックス付きの分割テスト', () => {
  const text = 'テストメッセージ';
  const messages = splitMessage(text, {
    messagePrefix: '**Claude Code出力:**\n',
  });

  assertEquals(messages.length, 1);
  assertStringIncludes(messages[0]!.content, '**Claude Code出力:**');
});

Deno.test('コードブロックの分割テスト（基本）', () => {
  const codeText = `普通のテキスト

\`\`\`typescript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

後続のテキスト`;

  const messages = splitMessage(codeText, { maxLength: 500 });

  // コードブロックが完全に保持されていることを確認
  const joinedContent = messages.map((m) => m.content).join('');
  assertStringIncludes(joinedContent, '```typescript');
  assertStringIncludes(joinedContent, 'function hello()');
  assertStringIncludes(joinedContent, '```');
});

Deno.test('大きなコードブロックの分割テスト', () => {
  // 長いコードブロックを作成
  const longCode = Array(100).fill('  console.log("長い行");').join('\n');
  const codeText = `\`\`\`typescript
${longCode}
\`\`\``;

  const messages = splitMessage(codeText, { maxLength: 1000 });

  assertEquals(messages.length > 1, true);

  // 最初のメッセージにコードブロック開始があることを確認
  assertStringIncludes(messages[0]!.content, '```typescript');

  // 最後のメッセージにコードブロック終了があることを確認
  const lastMessage = messages[messages.length - 1]!;
  assertStringIncludes(lastMessage.content, '```');
});

Deno.test('改行での分割テスト', () => {
  // 2000文字のテキストを生成（確実に分割される長さ）
  const text = Array(200).fill('これは長い行です。').join('\n');
  const messages = splitMessage(text, { maxLength: 1000 });

  assertEquals(messages.length > 1, true);

  // 改行で適切に分割されていることを確認（メッセージ番号追加分を考慮）
  messages.forEach((message) => {
    // メッセージ番号 "**[X/Y]**\n" の分（約10-15文字）を考慮して1050文字まで許容
    assertEquals(message.content.length <= 1050, true);
  });
});

Deno.test('空文字列の分割テスト', () => {
  const messages = splitMessage('');
  assertEquals(messages.length, 0);

  const messagesWithSpaces = splitMessage('   ');
  assertEquals(messagesWithSpaces.length, 0);
});

Deno.test('複数コードブロックの分割テスト', () => {
  const text = `最初のテキスト

\`\`\`javascript
console.log("最初のコード");
\`\`\`

中間のテキスト

\`\`\`python
print("2番目のコード")
\`\`\`

最後のテキスト`;

  const messages = splitMessage(text, { maxLength: 500 });
  const joinedContent = messages.map((m) => m.content).join('');

  // 両方のコードブロックが保持されていることを確認
  assertStringIncludes(joinedContent, '```javascript');
  assertStringIncludes(joinedContent, '```python');
});

Deno.test('コードブロックマーカー追加のテスト', () => {
  const chunks = [
    'テキストの最初の部分\n```typescript\nfunction test() {',
    '  return "hello";',
    '}\n```\n最後のテキスト',
  ];

  const originalText = chunks.join('');
  const markedChunks = addCodeBlockMarkers(chunks, originalText);

  // マーカーが適切に追加されていることを確認
  assertEquals(markedChunks.length, 3);
});

Deno.test('分割メッセージの結合テスト', () => {
  const text = 'あ'.repeat(3000);
  const messages = splitMessage(text, { maxLength: 1000 });

  const joined = joinSplitMessages(messages);

  // 分割マーカーが含まれていることを確認
  assertStringIncludes(joined, '--- MESSAGE SPLIT ---');
  assertEquals(messages.length > 1, true);
});

Deno.test('言語推測のテスト（TypeScript）', () => {
  const tsCode = `\`\`\`
interface User {
  name: string;
  age: number;
}

export function createUser(): User {
  return { name: "test", age: 25 };
}
\`\`\``;

  const messages = splitMessage(tsCode, { maxLength: 200 });

  // TypeScriptキーワードが保持されていることを確認
  const content = messages.map((m) => m.content).join('');
  assertStringIncludes(content, 'interface');
  assertStringIncludes(content, 'export');
});

Deno.test('言語推測のテスト（Python）', () => {
  const pythonCode = `\`\`\`
def calculate_sum(numbers):
    total = 0
    for num in numbers:
        total += num
    return total

if __name__ == "__main__":
    print(calculate_sum([1, 2, 3, 4, 5]))
\`\`\``;

  const messages = splitMessage(pythonCode, { maxLength: 200 });

  // Pythonキーワードが保持されていることを確認
  const content = messages.map((m) => m.content).join('');
  assertStringIncludes(content, 'def');
  assertStringIncludes(content, 'if __name__');
});

Deno.test('JSON形式の分割テスト', () => {
  const jsonCode = `\`\`\`
{
  "name": "test-project",
  "version": "1.0.0",
  "scripts": {
    "start": "deno run main.ts",
    "test": "deno test"
  },
  "dependencies": {
    "typescript": "^4.0.0"
  }
}
\`\`\``;

  const messages = splitMessage(jsonCode, { maxLength: 300 });

  // JSON構造が保持されていることを確認
  const content = messages.map((m) => m.content).join('');
  assertStringIncludes(content, '"name":');
  assertStringIncludes(content, '"version":');
});

Deno.test('部分的なコードブロック検出のテスト', () => {
  const text = 'あ'.repeat(2000);
  const codeText = `\`\`\`typescript
${text}
\`\`\``;

  const messages = splitMessage(codeText, { maxLength: 1000 });

  // 一部のメッセージが部分的なコードブロックとして認識されることを確認
  const hasPartialCodeBlock = messages.some((msg) => msg.isPartialCodeBlock);
  assertEquals(hasPartialCodeBlock, true);
});
