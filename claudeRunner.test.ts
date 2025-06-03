// claudeRunner.ts のテスト

import { assertEquals, assertExists, assertStringIncludes } from './deps.ts';
import {
  ClaudeExecutionMode,
  ClaudeRunner,
  DiffAnalyzer,
  ExecutionHistory,
  FileOperation,
  PromptTemplateManager,
  SyntaxHighlighter,
} from './claudeRunner.ts';

// テスト用のワークスペースパス
const testWorkingDirectory = '/tmp/test-claude-runner';

// テスト前後の環境セットアップ・クリーンアップ
async function setupTestEnvironment() {
  try {
    await Deno.remove(testWorkingDirectory, { recursive: true });
  } catch {
    // ディレクトリが存在しない場合は無視
  }

  await Deno.mkdir(testWorkingDirectory, { recursive: true });
}

async function cleanupTestEnvironment() {
  try {
    await Deno.remove(testWorkingDirectory, { recursive: true });
  } catch {
    // 無視
  }
}

Deno.test('DiffAnalyzer - diff解析', () => {
  const diffText = `diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdefg 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,8 @@
 export function example() {
-  console.log('old version');
+  console.log('new version');
+  console.log('additional line');
 }
 
+export function newFunction() {
+  return 'new';
+}`;

  const diffs = DiffAnalyzer.parseDiffs(diffText);

  assertEquals(diffs.length, 1);
  assertEquals(diffs[0]?.filePath, 'src/example.ts');
  assertEquals(diffs[0]?.type, 'modified');
  assertEquals(diffs[0]?.linesAdded, 5);
  assertEquals(diffs[0]?.linesDeleted, 1);
  assertExists(diffs[0]?.content);
});

Deno.test('DiffAnalyzer - 新規ファイル検出', () => {
  const diffText = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export function newFile() {
+  return 'hello';
+}`;

  const diffs = DiffAnalyzer.parseDiffs(diffText);

  assertEquals(diffs.length, 1);
  assertEquals(diffs[0]?.type, 'added');
  assertEquals(diffs[0]?.filePath, 'src/new-file.ts');
  assertEquals(diffs[0]?.linesAdded, 3);
  assertEquals(diffs[0]?.linesDeleted, 0);
});

Deno.test('DiffAnalyzer - ファイル削除検出', () => {
  const diffText = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldFile() {
-  return 'goodbye';
-}`;

  const diffs = DiffAnalyzer.parseDiffs(diffText);

  assertEquals(diffs.length, 1);
  assertEquals(diffs[0]?.type, 'deleted');
  assertEquals(diffs[0]?.filePath, 'src/old-file.ts');
  assertEquals(diffs[0]?.linesAdded, 0);
  assertEquals(diffs[0]?.linesDeleted, 3);
});

Deno.test('DiffAnalyzer - ファイルリネーム検出', () => {
  const diffText = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index 1234567..abcdefg 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export function example() {
-  return 'old';
+  return 'new';
 }`;

  const diffs = DiffAnalyzer.parseDiffs(diffText);

  assertEquals(diffs.length, 1);
  assertEquals(diffs[0]?.type, 'renamed');
  assertEquals(diffs[0]?.filePath, 'src/new-name.ts');
  assertEquals(diffs[0]?.oldPath, 'src/old-name.ts');
});

Deno.test('DiffAnalyzer - ファイル操作検出', () => {
  const output = `Created file: src/components/Button.tsx
Modified file: src/utils/helpers.ts
Deleted file: src/legacy/old-component.tsx
Renamed file: src/types.ts -> src/types/index.ts`;

  const operations = DiffAnalyzer.detectFileOperations(output, testWorkingDirectory);

  assertEquals(operations.length, 4);
  assertEquals(operations[0]?.type, 'create');
  assertEquals(operations[1]?.type, 'modify');
  assertEquals(operations[2]?.type, 'delete');
  assertEquals(operations[3]?.type, 'rename');

  assertStringIncludes(operations[0]?.filePath || '', 'src/components/Button.tsx');
  assertStringIncludes(operations[3]?.filePath || '', 'src/types/index.ts');
  assertStringIncludes(operations[3]?.oldPath || '', 'src/types.ts');
});

Deno.test('SyntaxHighlighter - Discord形式ハイライト', () => {
  const code = `function example() {
  return 'hello';
}`;

  const highlighted = SyntaxHighlighter.highlightForDiscord(code, 'javascript');

  assertStringIncludes(highlighted, '```javascript');
  assertStringIncludes(highlighted, code);
  assertStringIncludes(highlighted, '```');
});

Deno.test('SyntaxHighlighter - diff形式ハイライト', () => {
  const diff = `@@ -1,3 +1,4 @@
 function example() {
-  return 'old';
+  return 'new';
+  console.log('added');
 }`;

  const highlighted = SyntaxHighlighter.highlightDiff(diff);

  assertStringIncludes(highlighted, '```diff');
  assertStringIncludes(highlighted, "+   return 'new';");
  assertStringIncludes(highlighted, "-   return 'old';");
  assertStringIncludes(highlighted, '# @@ -1,3 +1,4 @@');
});

Deno.test('SyntaxHighlighter - ファイル操作要約', () => {
  const operations: FileOperation[] = [
    { type: 'create', filePath: '/test/file1.ts', timestamp: new Date() },
    { type: 'modify', filePath: '/test/file2.ts', timestamp: new Date() },
    { type: 'modify', filePath: '/test/file3.ts', timestamp: new Date() },
    { type: 'delete', filePath: '/test/file4.ts', timestamp: new Date() },
  ];

  const summary = SyntaxHighlighter.summarizeFileOperations(operations);

  assertStringIncludes(summary, '作成: 1個');
  assertStringIncludes(summary, '変更: 2個');
  assertStringIncludes(summary, '削除: 1個');
});

Deno.test('PromptTemplateManager - デフォルトテンプレート', () => {
  const manager = new PromptTemplateManager();

  const templates = manager.getAllTemplates();
  assertEquals(templates.length >= 3, true);

  const bugFixTemplate = manager.getTemplate('bug-fix');
  assertExists(bugFixTemplate);
  assertEquals(bugFixTemplate.name, 'bug-fix');
  assertStringIncludes(bugFixTemplate.content, '{{description}}');
});

Deno.test('PromptTemplateManager - テンプレート展開', () => {
  const manager = new PromptTemplateManager();

  const expanded = manager.expandTemplate('bug-fix', {
    description: 'ボタンが押せない',
    steps: '1. ページを開く\n2. ボタンをクリック',
    expected: 'ボタンが動作する',
    actual: 'ボタンが反応しない',
  });

  assertStringIncludes(expanded, 'ボタンが押せない');
  assertStringIncludes(expanded, 'ページを開く');
  assertStringIncludes(expanded, 'ボタンが動作する');
  assertStringIncludes(expanded, 'ボタンが反応しない');
});

Deno.test('PromptTemplateManager - 必須変数チェック', () => {
  const manager = new PromptTemplateManager();

  let errorThrown = false;
  try {
    manager.expandTemplate('bug-fix', {
      description: 'テスト',
      // steps, expected, actualが不足
    });
  } catch (error) {
    errorThrown = true;
    assertStringIncludes(error instanceof Error ? error.message : String(error), '必須変数');
  }

  assertEquals(errorThrown, true);
});

Deno.test('PromptTemplateManager - カテゴリ別取得', () => {
  const manager = new PromptTemplateManager();

  const developmentTemplates = manager.getTemplatesByCategory('development');
  assertEquals(developmentTemplates.length >= 2, true);

  const reviewTemplates = manager.getTemplatesByCategory('review');
  assertEquals(reviewTemplates.length >= 1, true);
});

Deno.test('ExecutionHistory - 履歴追加と取得', async () => {
  const testHistoryFile = '/tmp/test-execution-history.json';

  try {
    await Deno.remove(testHistoryFile);
  } catch {
    // ファイルが存在しない場合は無視
  }

  const history = new ExecutionHistory(10, testHistoryFile);

  const entryId = history.addEntry({
    mode: ClaudeExecutionMode.PRINT,
    prompt: 'テストプロンプト',
    workingDirectory: testWorkingDirectory,
    result: {
      success: true,
      stdout: 'テスト出力',
      stderr: '',
      duration: 1000,
    },
    userId: 'test-user',
  });

  assertExists(entryId);

  const entries = history.getHistory();
  assertEquals(entries.length, 1);
  assertEquals(entries[0]?.prompt, 'テストプロンプト');
  assertEquals(entries[0]?.userId, 'test-user');

  const entry = history.getEntry(entryId);
  assertExists(entry);
  assertEquals(entry.id, entryId);

  try {
    await Deno.remove(testHistoryFile);
  } catch {
    // 無視
  }
});

Deno.test('ExecutionHistory - ユーザー別履歴', async () => {
  const testHistoryFile = '/tmp/test-user-history.json';

  try {
    await Deno.remove(testHistoryFile);
  } catch {
    // ファイルが存在しない場合は無視
  }

  const history = new ExecutionHistory(10, testHistoryFile);

  // ユーザー1の履歴
  history.addEntry({
    mode: ClaudeExecutionMode.PRINT,
    prompt: 'ユーザー1のプロンプト1',
    workingDirectory: testWorkingDirectory,
    result: { success: true, stdout: '', stderr: '', duration: 1000 },
    userId: 'user1',
  });

  history.addEntry({
    mode: ClaudeExecutionMode.PRINT,
    prompt: 'ユーザー1のプロンプト2',
    workingDirectory: testWorkingDirectory,
    result: { success: true, stdout: '', stderr: '', duration: 1000 },
    userId: 'user1',
  });

  // ユーザー2の履歴
  history.addEntry({
    mode: ClaudeExecutionMode.PRINT,
    prompt: 'ユーザー2のプロンプト',
    workingDirectory: testWorkingDirectory,
    result: { success: true, stdout: '', stderr: '', duration: 1000 },
    userId: 'user2',
  });

  const user1History = history.getHistoryByUser('user1');
  assertEquals(user1History.length, 2);

  const user2History = history.getHistoryByUser('user2');
  assertEquals(user2History.length, 1);

  try {
    await Deno.remove(testHistoryFile);
  } catch {
    // 無視
  }
});

Deno.test('ClaudeRunner - 初期化', async () => {
  await setupTestEnvironment();

  try {
    const runner = new ClaudeRunner({
      maxBufferChunks: 100,
      maxHistoryEntries: 50,
    });

    await runner.initialize();

    const templateManager = runner.getTemplateManager();
    assertExists(templateManager);

    const templates = templateManager.getAllTemplates();
    assertEquals(templates.length >= 3, true);

    const executionHistory = runner.getExecutionHistory();
    assertExists(executionHistory);
  } finally {
    await cleanupTestEnvironment();
  }
});

Deno.test('ClaudeRunner - 出力バッファ', async () => {
  await setupTestEnvironment();

  try {
    const runner = new ClaudeRunner();

    // 初期状態では空
    assertEquals(runner.getOutputBuffer(), '');

    const latestOutput = runner.getLatestOutput(5);
    assertEquals(latestOutput, '');
  } finally {
    await cleanupTestEnvironment();
  }
});
