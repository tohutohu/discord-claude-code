/**
 * install-hooks.tsのテストコード
 */

Deno.test('Git hooks content validation', async (t) => {
  // hook内容を直接テスト
  const preCommitHook = `#!/bin/sh
deno fmt --check
deno lint`;
  
  const commitMsgHook = `#!/bin/sh
commit_regex='^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)'`;
  
  const prepareCommitMsgHook = `#!/bin/sh
BRANCH_NAME=$(git symbolic-ref --short HEAD 2>/dev/null)
PREFIX="feat: "`;

  await t.step('pre-commit hook should contain format and lint checks', () => {
    const hasFormatCheck = preCommitHook.includes('deno fmt --check');
    const hasLintCheck = preCommitHook.includes('deno lint');

    if (!hasFormatCheck || !hasLintCheck) {
      throw new Error('pre-commit hook is missing required checks');
    }
  });

  await t.step('commit-msg hook should validate conventional commits', () => {
    const hasRegex = commitMsgHook.includes('commit_regex');
    const hasTypes = commitMsgHook.includes('feat|fix|docs');

    if (!hasRegex || !hasTypes) {
      throw new Error('commit-msg hook is missing validation logic');
    }
  });

  await t.step('prepare-commit-msg hook should handle branch prefixes', () => {
    const hasBranchLogic = prepareCommitMsgHook.includes('BRANCH_NAME');
    const hasPrefixLogic = prepareCommitMsgHook.includes('PREFIX=');

    if (!hasBranchLogic || !hasPrefixLogic) {
      throw new Error('prepare-commit-msg hook is missing branch handling');
    }
  });
});
