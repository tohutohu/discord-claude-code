/**
 * Git Hooksインストールスクリプトのテスト
 */

import { assertStringIncludes } from '@std/assert';

// テスト対象のフック内容を取得するためにモジュールをインポート
// 実際のフック内容は scripts/install-hooks.ts に定義されているため、
// ここではフック内容の検証のみを行う

Deno.test('Git hooks インストールスクリプト', async (t) => {
  // pre-commitフックの内容を検証
  await t.step(
    'pre-commitフックがフォーマット、リント、タイプチェック、テストを含むこと',
    async () => {
      // scripts/install-hooks.ts を読み込んで内容を検証
      const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');

      // pre-commitフックの定義を探す
      const preCommitMatch = scriptContent.match(/const preCommitHook = `([^`]+)`/s);
      if (!preCommitMatch || preCommitMatch.length < 2) {
        throw new Error('pre-commitフックの定義が見つかりません');
      }

      const preCommitContent = preCommitMatch[1]!;
      assertStringIncludes(preCommitContent, 'deno fmt --check');
      assertStringIncludes(preCommitContent, 'deno lint');
      assertStringIncludes(preCommitContent, 'deno task check');
      assertStringIncludes(preCommitContent, 'deno task test');
      assertStringIncludes(preCommitContent, 'All pre-commit checks passed!');
    },
  );

  // commit-msgフックの内容を検証
  await t.step('commit-msgフックがConventional Commitsを検証すること', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');

    const commitMsgMatch = scriptContent.match(/const commitMsgHook = `([^`]+)`/s);
    if (!commitMsgMatch || commitMsgMatch.length < 2) {
      throw new Error('commit-msgフックの定義が見つかりません');
    }

    const commitMsgContent = commitMsgMatch[1]!;
    assertStringIncludes(commitMsgContent, 'commit_regex');
    assertStringIncludes(
      commitMsgContent,
      'feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert',
    );
    assertStringIncludes(commitMsgContent, 'Conventional Commits format');
  });

  // prepare-commit-msgフックの内容を検証
  await t.step('prepare-commit-msgフックがブランチ名からプレフィックスを追加すること', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');

    const prepareCommitMatch = scriptContent.match(/const prepareCommitMsgHook = `([^`]+)`/s);
    if (!prepareCommitMatch || prepareCommitMatch.length < 2) {
      throw new Error('prepare-commit-msgフックの定義が見つかりません');
    }

    const prepareCommitContent = prepareCommitMatch[1]!;
    assertStringIncludes(prepareCommitContent, 'BRANCH_NAME');
    assertStringIncludes(prepareCommitContent, 'git symbolic-ref --short HEAD');
    assertStringIncludes(prepareCommitContent, 'PREFIX=');
    assertStringIncludes(prepareCommitContent, 'feat/*) PREFIX="feat: "');
  });

  // インストール機能のテスト
  await t.step('Gitリポジトリ外での実行時にエラーメッセージを表示すること', async () => {
    // このテストは実際のGitリポジトリ構造に依存するため、
    // エラーメッセージの存在のみを確認
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    assertStringIncludes(scriptContent, 'Not a git repository');
  });
});

// フック内容の詳細なテスト
Deno.test('pre-commitフックの詳細動作', async (t) => {
  await t.step('フォーマットチェック失敗時のメッセージ', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    const preCommitMatch = scriptContent.match(/const preCommitHook = `([^`]+)`/s);
    if (!preCommitMatch || preCommitMatch.length < 2) {
      throw new Error('pre-commitフックの定義が見つかりません');
    }
    const preCommitContent = preCommitMatch[1]!;

    assertStringIncludes(preCommitContent, "Format check failed. Please run 'deno task fmt'");
  });

  await t.step('リントチェック失敗時のメッセージ', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    const preCommitMatch = scriptContent.match(/const preCommitHook = `([^`]+)`/s);
    if (!preCommitMatch || preCommitMatch.length < 2) {
      throw new Error('pre-commitフックの定義が見つかりません');
    }
    const preCommitContent = preCommitMatch[1]!;

    assertStringIncludes(preCommitContent, 'Lint check failed. Please fix the errors above');
  });

  await t.step('タイプチェック失敗時のメッセージ', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    const preCommitMatch = scriptContent.match(/const preCommitHook = `([^`]+)`/s);
    if (!preCommitMatch || preCommitMatch.length < 2) {
      throw new Error('pre-commitフックの定義が見つかりません');
    }
    const preCommitContent = preCommitMatch[1]!;

    assertStringIncludes(preCommitContent, 'Type check failed. Please fix the type errors above');
  });

  await t.step('テスト失敗時のメッセージ', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    const preCommitMatch = scriptContent.match(/const preCommitHook = `([^`]+)`/s);
    if (!preCommitMatch || preCommitMatch.length < 2) {
      throw new Error('pre-commitフックの定義が見つかりません');
    }
    const preCommitContent = preCommitMatch[1]!;

    assertStringIncludes(preCommitContent, 'Tests failed. Please fix the failing tests above');
  });
});

Deno.test('commit-msgフックの詳細動作', async (t) => {
  await t.step('コミットメッセージの形式例が含まれること', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    const commitMsgMatch = scriptContent.match(/const commitMsgHook = `([^`]+)`/s);
    if (!commitMsgMatch || commitMsgMatch.length < 2) {
      throw new Error('commit-msgフックの定義が見つかりません');
    }
    const commitMsgContent = commitMsgMatch[1]!;

    assertStringIncludes(commitMsgContent, 'feat: add new feature');
    assertStringIncludes(commitMsgContent, 'fix(auth): resolve login issue');
    assertStringIncludes(commitMsgContent, 'docs: update README');
  });

  await t.step('すべてのコミットタイプが定義されていること', async () => {
    const scriptContent = await Deno.readTextFile('./scripts/install-hooks.ts');
    const commitMsgMatch = scriptContent.match(/const commitMsgHook = `([^`]+)`/s);
    if (!commitMsgMatch || commitMsgMatch.length < 2) {
      throw new Error('commit-msgフックの定義が見つかりません');
    }
    const commitMsgContent = commitMsgMatch[1]!;

    const expectedTypes = [
      'feat',
      'fix',
      'docs',
      'style',
      'refactor',
      'test',
      'chore',
      'perf',
      'ci',
      'build',
      'revert',
    ];
    for (const type of expectedTypes) {
      assertStringIncludes(commitMsgContent, type);
    }
  });
});
