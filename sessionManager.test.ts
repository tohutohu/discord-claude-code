// sessionManager.ts のテスト

import { assertEquals, assertExists, assertRejects } from './deps.ts';
import {
  disposeSessionManager,
  getSessionManager,
  initializeSessionManager,
  SessionManager,
} from './sessionManager.ts';
import { SessionState } from './types/discord.ts';

// テスト用の一時ファイルパス
const testStoragePath = '/tmp/test-sessions.json';

// テスト後にファイルを削除
async function cleanupTestFile() {
  try {
    await Deno.remove(testStoragePath);
  } catch {
    // ファイルが存在しない場合は無視
  }
}

Deno.test('セッション管理 - セッション作成', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  const session = await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  assertEquals(session.threadId, 'thread-123');
  assertEquals(session.repository, 'test-repo');
  assertEquals(session.worktreePath, '/path/to/worktree');
  assertEquals(session.state, SessionState.INITIALIZING);
  assertExists(session.createdAt);
  assertExists(session.updatedAt);
  assertEquals(session.metadata.userId, 'user-456');
  assertEquals(session.metadata.guildId, 'guild-789');

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 重複セッション作成エラー', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  await assertRejects(
    async () => {
      await manager.createSession(
        'thread-123',
        'another-repo',
        '/another/path',
        {
          userId: 'user-999',
          guildId: 'guild-999',
        },
      );
    },
    Error,
    'セッション thread-123 は既に存在します',
  );

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 状態遷移', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  // 正常な状態遷移
  await manager.changeSessionState('thread-123', SessionState.STARTING);
  const session1 = manager.getSession('thread-123');
  assertEquals(session1?.state, SessionState.STARTING);

  await manager.changeSessionState('thread-123', SessionState.READY);
  const session2 = manager.getSession('thread-123');
  assertEquals(session2?.state, SessionState.READY);

  await manager.changeSessionState('thread-123', SessionState.RUNNING);
  const session3 = manager.getSession('thread-123');
  assertEquals(session3?.state, SessionState.RUNNING);

  await manager.changeSessionState('thread-123', SessionState.COMPLETED);
  const session4 = manager.getSession('thread-123');
  assertEquals(session4?.state, SessionState.COMPLETED);

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 不正な状態遷移エラー', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  // 不正な状態遷移（INITIALIZING -> RUNNING は不可）
  await assertRejects(
    async () => {
      await manager.changeSessionState('thread-123', SessionState.RUNNING);
    },
    Error,
    '不正な状態遷移',
  );

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 存在しないセッションへの状態変更エラー', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await assertRejects(
    async () => {
      await manager.changeSessionState('nonexistent', SessionState.RUNNING);
    },
    Error,
    'セッション nonexistent が見つかりません',
  );

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - セッション取得', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  const session = manager.getSession('thread-123');
  assertExists(session);
  assertEquals(session.threadId, 'thread-123');

  const nonexistent = manager.getSession('nonexistent');
  assertEquals(nonexistent, undefined);

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 全セッション取得', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo-1',
    '/path/to/worktree1',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  await manager.createSession(
    'thread-456',
    'test-repo-2',
    '/path/to/worktree2',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  const allSessions = manager.getAllSessions();
  assertEquals(allSessions.length, 2);

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - アクティブセッション取得', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  // アクティブなセッション
  await manager.createSession(
    'thread-active',
    'test-repo-1',
    '/path/to/worktree1',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  // 完了したセッション
  await manager.createSession(
    'thread-completed',
    'test-repo-2',
    '/path/to/worktree2',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );
  await manager.changeSessionState('thread-completed', SessionState.STARTING);
  await manager.changeSessionState('thread-completed', SessionState.READY);
  await manager.changeSessionState('thread-completed', SessionState.RUNNING);
  await manager.changeSessionState('thread-completed', SessionState.COMPLETED);

  const activeSessions = manager.getActiveSessions();
  assertEquals(activeSessions.length, 1);
  assertEquals(activeSessions[0]?.threadId, 'thread-active');

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - セッション削除', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  let session = manager.getSession('thread-123');
  assertExists(session);

  await manager.removeSession('thread-123');

  session = manager.getSession('thread-123');
  assertEquals(session, undefined);

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - コンテナID更新', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  await manager.updateContainerId('thread-123', 'container-abc123');

  const session = manager.getSession('thread-123');
  assertEquals(session?.containerId, 'container-abc123');

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 存在しないセッションのコンテナID更新エラー', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  await assertRejects(
    async () => {
      await manager.updateContainerId('nonexistent', 'container-abc123');
    },
    Error,
    'セッション nonexistent が見つかりません',
  );

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - イベント発火', async () => {
  await cleanupTestFile();

  const manager = new SessionManager(testStoragePath);

  let eventReceived = false;
  let stateChangeEventReceived = false;

  manager.addEventListener('session-created', () => {
    eventReceived = true;
  });

  manager.addEventListener('session-state-change', () => {
    stateChangeEventReceived = true;
  });

  await manager.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  await manager.changeSessionState('thread-123', SessionState.STARTING);

  assertEquals(eventReceived, true);
  assertEquals(stateChangeEventReceived, true);

  await manager.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - データ永続化と復元', async () => {
  await cleanupTestFile();

  // 最初のマネージャーでセッションを作成
  const manager1 = new SessionManager(testStoragePath);

  await manager1.createSession(
    'thread-123',
    'test-repo',
    '/path/to/worktree',
    {
      userId: 'user-456',
      guildId: 'guild-789',
    },
  );

  await manager1.dispose();

  // 新しいマネージャーでデータを復元
  const manager2 = new SessionManager(testStoragePath);
  await manager2.loadSessions();

  const session = manager2.getSession('thread-123');
  assertExists(session);
  assertEquals(session.threadId, 'thread-123');
  assertEquals(session.repository, 'test-repo');

  await manager2.dispose();
  await cleanupTestFile();
});

Deno.test('セッション管理 - シングルトンインスタンス', async () => {
  await disposeSessionManager();

  const manager1 = getSessionManager(testStoragePath);
  const manager2 = getSessionManager(testStoragePath);

  assertEquals(manager1, manager2);

  await disposeSessionManager();
  await cleanupTestFile();
});

Deno.test('セッション管理 - 初期化', async () => {
  await disposeSessionManager();
  await cleanupTestFile();

  const manager = await initializeSessionManager(testStoragePath);
  assertExists(manager);

  await disposeSessionManager();
  await cleanupTestFile();
});
