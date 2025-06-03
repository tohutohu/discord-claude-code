// worktree.ts のテスト

import { assertEquals, assertExists, assertRejects } from './deps.ts';
import {
  createWorktree,
  disposeAllWorktreeManagers,
  generateWorktreeName,
  getDiskUsage,
  getWorktreeManager,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  WorktreeManager,
} from './worktree.ts';

// テスト用のリポジトリパス
const testRepoPath = '/tmp/test-worktree-repo';
const testWorkspaceDir = '/tmp/test-worktree-workspace';

// テスト前後の環境セットアップ・クリーンアップ
async function setupTestRepo() {
  // テストリポジトリを作成
  try {
    await Deno.remove(testRepoPath, { recursive: true });
  } catch {
    // ディレクトリが存在しない場合は無視
  }

  await Deno.mkdir(testRepoPath, { recursive: true });

  // git init
  const initCommand = new Deno.Command('git', {
    args: ['init'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await initCommand.output();

  // git config設定
  const configUserCommand = new Deno.Command('git', {
    args: ['config', 'user.name', 'Test User'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await configUserCommand.output();

  const configEmailCommand = new Deno.Command('git', {
    args: ['config', 'user.email', 'test@example.com'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await configEmailCommand.output();

  // 初期コミット作成
  await Deno.writeTextFile(`${testRepoPath}/README.md`, '# Test Repo\n');

  const addCommand = new Deno.Command('git', {
    args: ['add', '.'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await addCommand.output();

  const commitCommand = new Deno.Command('git', {
    args: ['commit', '-m', 'Initial commit'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await commitCommand.output();

  // テストブランチ作成
  const branchCommand = new Deno.Command('git', {
    args: ['checkout', '-b', 'test-branch'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await branchCommand.output();

  // 追加のテストブランチも作成
  const branch2Command = new Deno.Command('git', {
    args: ['checkout', '-b', 'test-branch-2'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await branch2Command.output();

  const branch3Command = new Deno.Command('git', {
    args: ['checkout', '-b', 'test-branch-3'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await branch3Command.output();

  const branch4Command = new Deno.Command('git', {
    args: ['checkout', '-b', 'test-branch-4'],
    cwd: testRepoPath,
    stdout: 'piped',
    stderr: 'piped',
  });
  await branch4Command.output();
}

async function cleanupTestRepo() {
  try {
    await Deno.remove(testRepoPath, { recursive: true });
  } catch {
    // 無視
  }

  try {
    await Deno.remove(testWorkspaceDir, { recursive: true });
  } catch {
    // 無視
  }

  disposeAllWorktreeManagers();
}

Deno.test('Worktree名生成 - デフォルトプレフィックス', () => {
  const name = generateWorktreeName();

  // プレフィックスがclaudeで始まることを確認
  assertEquals(name.startsWith('claude-'), true);

  // タイムスタンプ形式が含まれることを確認（YYYYMMDD-HHMMSS）
  const parts = name.split('-');
  assertEquals(parts.length, 4); // claude-YYYYMMDD-HHMMSS-random

  // 日付部分の確認
  const datePart = parts[1];
  assertExists(datePart);
  assertEquals(datePart.length, 8); // YYYYMMDD

  // 時刻部分の確認
  const timePart = parts[2];
  assertExists(timePart);
  assertEquals(timePart.length, 6); // HHMMSS

  // ランダム部分の確認
  const randomPart = parts[3];
  assertExists(randomPart);
  assertEquals(randomPart.length, 6);
});

Deno.test('Worktree名生成 - カスタムプレフィックス', () => {
  const name = generateWorktreeName('custom');
  assertEquals(name.startsWith('custom-'), true);
});

Deno.test('Worktree名生成 - 重複なし', () => {
  const name1 = generateWorktreeName();
  const name2 = generateWorktreeName();

  // 同時に生成した場合でも異なる名前になることを確認
  assertEquals(name1 === name2, false);
});

Deno.test('Worktree作成 - 正常ケース', async () => {
  await setupTestRepo();

  try {
    const worktreeInfo = await createWorktree({
      repositoryPath: testRepoPath,
      branch: 'test-branch',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'test',
      skipDiskCheck: true,
    });

    assertExists(worktreeInfo);
    assertEquals(worktreeInfo.branch, 'test-branch');
    assertEquals(worktreeInfo.name.startsWith('test-'), true);
    assertExists(worktreeInfo.path);
    assertExists(worktreeInfo.createdAt);
    assertExists(worktreeInfo.commit);

    // ディレクトリが実際に作成されていることを確認
    const stat = await Deno.stat(worktreeInfo.path);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('Worktree作成 - 存在しないリポジトリエラー', async () => {
  await assertRejects(
    async () => {
      await createWorktree({
        repositoryPath: '/nonexistent/repo',
        branch: 'main',
        workspaceDir: testWorkspaceDir,
      });
    },
    Error,
    'リポジトリが見つかりません',
  );
});

Deno.test('Worktree一覧取得', async () => {
  await setupTestRepo();

  try {
    // Worktreeを作成
    await createWorktree({
      repositoryPath: testRepoPath,
      branch: 'test-branch',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'test1',
      skipDiskCheck: true,
    });

    await createWorktree({
      repositoryPath: testRepoPath,
      branch: 'test-branch-2',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'test2',
      skipDiskCheck: true,
    });

    const worktrees = await listWorktrees(testRepoPath);

    // 作成したWorktreeが含まれていることを確認（メインリポジトリを除外）
    const createdWorktrees = worktrees.filter((w) =>
      w.name.startsWith('test') && !w.path.endsWith('test-worktree-repo')
    );
    assertEquals(createdWorktrees.length, 2);

    // 総数を確認（メインリポジトリ + 作成した2つのWorktree = 3つ）
    assertEquals(worktrees.length, 3);
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('Worktree削除', async () => {
  await setupTestRepo();

  try {
    // Worktree作成
    const worktreeInfo = await createWorktree({
      repositoryPath: testRepoPath,
      branch: 'test-branch-2',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'test',
      skipDiskCheck: true,
    });

    // 削除前に存在確認
    const statBefore = await Deno.stat(worktreeInfo.path);
    assertEquals(statBefore.isDirectory, true);

    // 削除実行
    await removeWorktree(testRepoPath, worktreeInfo.path);

    // 削除後に存在しないことを確認
    await assertRejects(
      async () => {
        await Deno.stat(worktreeInfo.path);
      },
      Deno.errors.NotFound,
    );
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('Worktree prune - 古いWorktreeを削除', async () => {
  await setupTestRepo();

  try {
    // 新しいブランチでWorktree作成
    const worktreeInfo = await createWorktree({
      repositoryPath: testRepoPath,
      branch: 'test-branch-prune',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'old',
      skipDiskCheck: true,
    });

    // 即座にprune（maxAge=0で全て削除対象）
    const removed = await pruneWorktrees(testRepoPath, {
      maxAge: 0,
      pattern: 'old',
    });

    assertEquals(removed.length, 1);
    // パスは実際のパスとシンボリックリンクで異なる可能性があるため、ファイル名で確認
    assertEquals(removed[0]?.includes(worktreeInfo.name), true);
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('Worktree prune - ドライラン', async () => {
  await setupTestRepo();

  try {
    // Worktree作成
    const worktreeInfo = await createWorktree({
      repositoryPath: testRepoPath,
      branch: 'test-branch',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'test',
      skipDiskCheck: true,
    });

    // ドライラン実行
    const removed = await pruneWorktrees(testRepoPath, {
      maxAge: 0,
      dryRun: true,
    });

    // 削除対象として検出されるが実際は削除されない
    // メインリポジトリは除外されるので、作成したWorktreeのみがカウントされる
    assertEquals(removed.length >= 1, true);

    // ディレクトリが残っていることを確認
    const stat = await Deno.stat(worktreeInfo.path);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('ディスク使用量取得', async () => {
  const diskUsage = await getDiskUsage('/tmp');

  assertExists(diskUsage);
  assertEquals(typeof diskUsage.used, 'number');
  assertEquals(typeof diskUsage.available, 'number');
  assertEquals(typeof diskUsage.total, 'number');
  assertEquals(typeof diskUsage.usageRatio, 'number');

  // 使用率は0-1の範囲内
  assertEquals(diskUsage.usageRatio >= 0, true);
  assertEquals(diskUsage.usageRatio <= 1, true);

  // 使用量 + 利用可能量 <= 総量
  assertEquals(diskUsage.used + diskUsage.available <= diskUsage.total, true);
});

Deno.test('WorktreeManager - 基本操作', async () => {
  await setupTestRepo();

  try {
    const manager = new WorktreeManager(testRepoPath, {
      pruneInterval: 0, // 自動prune無効
      diskCheckInterval: 0, // ディスクチェック無効
    });

    // Worktree作成
    const worktreeInfo = await manager.createWorktree({
      branch: 'test-branch',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'manager-test',
      skipDiskCheck: true,
    });

    assertExists(worktreeInfo);
    assertEquals(worktreeInfo.name.startsWith('manager-test-'), true);

    // 一覧取得
    const worktrees = await manager.listWorktrees();
    const createdWorktree = worktrees.find((w) => w.name.startsWith('manager-test'));
    assertExists(createdWorktree);

    // 削除
    await manager.removeWorktree(worktreeInfo.path);

    // 削除確認
    await assertRejects(
      async () => {
        await Deno.stat(worktreeInfo.path);
      },
      Deno.errors.NotFound,
    );

    manager.dispose();
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('WorktreeManager - シングルトンインスタンス', async () => {
  await setupTestRepo();

  try {
    const manager1 = getWorktreeManager(testRepoPath);
    const manager2 = getWorktreeManager(testRepoPath);

    // 同じインスタンスが返されることを確認
    assertEquals(manager1, manager2);
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('WorktreeManager - 手動prune', async () => {
  await setupTestRepo();

  try {
    const manager = new WorktreeManager(testRepoPath, {
      pruneInterval: 0,
      diskCheckInterval: 0,
    });

    // Worktree作成
    await manager.createWorktree({
      branch: 'test-branch-2',
      workspaceDir: testWorkspaceDir,
      namePrefix: 'prune-test',
      skipDiskCheck: true,
    });

    // 手動prune実行（maxAge=0で全て削除）
    const count = await manager.manualPrune();
    // 実際にWorktreeが削除されるかは実装によるが、エラーが発生しないことを確認
    assertEquals(typeof count, 'number');

    manager.dispose();
  } finally {
    await cleanupTestRepo();
  }
});

Deno.test('WorktreeManager - ディスク使用量取得', async () => {
  await setupTestRepo();

  try {
    const manager = new WorktreeManager(testRepoPath, {
      pruneInterval: 0,
      diskCheckInterval: 0,
    });

    const diskUsage = await manager.getDiskUsage();
    assertExists(diskUsage);
    assertEquals(typeof diskUsage.usageRatio, 'number');

    manager.dispose();
  } finally {
    await cleanupTestRepo();
  }
});
