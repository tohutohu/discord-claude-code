import { assertEquals, assertThrows } from "std/assert/mod.ts";
import {
  AuditEntrySchema,
  parseJsonlSafe,
  parseJsonSafe,
  SessionLogSchema,
  ThreadInfoSchema,
  validateAdminState,
  validateAuditEntry,
  validateRepositoryPatInfo,
  validateSessionLog,
  validateThreadInfo,
  validateThreadQueue,
  validateWorkerState,
} from "./index.ts";

Deno.test("ThreadInfoSchema - 有効なデータを検証", () => {
  const validData = {
    threadId: "1234567890",
    repositoryFullName: "owner/repo",
    repositoryLocalPath: "/path/to/repo",
    worktreePath: "/path/to/worktree",
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActiveAt: "2024-01-01T00:00:00.000Z",
    status: "active" as const,
  };

  const result = validateThreadInfo(validData);
  assertEquals(result, validData);
});

Deno.test("ThreadInfoSchema - 無効なthreadIdで失敗", () => {
  const invalidData = {
    threadId: "not-a-number",
    repositoryFullName: "owner/repo",
    repositoryLocalPath: null,
    worktreePath: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActiveAt: "2024-01-01T00:00:00.000Z",
    status: "active",
  };

  assertThrows(() => validateThreadInfo(invalidData));
});

Deno.test("SessionLogSchema - 有効なデータを検証", () => {
  const validData = {
    timestamp: "2024-01-01T00:00:00.000Z",
    sessionId: "session123",
    type: "request",
    content: "Some content",
  };

  const result = validateSessionLog(validData);
  assertEquals(result, validData);
});

Deno.test("SessionLogSchema - 無効なtypeで失敗", () => {
  const invalidData = {
    timestamp: "2024-01-01T00:00:00.000Z",
    sessionId: "session123",
    type: "invalid-type",
    content: "Some content",
  };

  assertThrows(() => validateSessionLog(invalidData));
});

Deno.test("AuditEntrySchema - 有効なデータを検証", () => {
  const validData = {
    timestamp: "2024-01-01T00:00:00.000Z",
    threadId: "1234567890",
    action: "worker_created",
    details: {
      workerName: "worker-1",
      repository: "owner/repo",
    },
  };

  const result = validateAuditEntry(validData);
  assertEquals(result, validData);
});

Deno.test("AdminStateSchema - 有効なデータを検証", () => {
  const validData = {
    activeThreadIds: ["1234567890", "9876543210"],
    lastUpdated: "2024-01-01T00:00:00.000Z",
  };

  const result = validateAdminState(validData);
  assertEquals(result, validData);
});

Deno.test("WorkerStateSchema - 有効なデータを検証", () => {
  const validData = {
    workerName: "worker-1",
    threadId: "1234567890",
    threadName: "Test Thread",
    repository: {
      fullName: "owner/repo",
      org: "owner",
      repo: "repo",
    },
    repositoryLocalPath: "/path/to/repo",
    worktreePath: "/path/to/worktree",
    devcontainerConfig: {
      useDevcontainer: true,
      useFallbackDevcontainer: false,
      hasDevcontainerFile: true,
      hasAnthropicsFeature: false,
      containerId: "container123",
      isStarted: true,
    },
    sessionId: "session123",
    status: "active" as const,
    rateLimitTimestamp: 1704067200000,
    autoResumeAfterRateLimit: true,
    queuedMessages: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActiveAt: "2024-01-01T00:00:00.000Z",
  };

  const result = validateWorkerState(validData);
  assertEquals(result, validData);
});

Deno.test("RepositoryPatInfoSchema - 有効なデータを検証", () => {
  const validData = {
    repositoryFullName: "owner/repo",
    token: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    description: "Test PAT for repository",
  };

  const result = validateRepositoryPatInfo(validData);
  assertEquals(result, validData);
});

Deno.test("ThreadQueueSchema - 有効なデータを検証", () => {
  const validData = {
    threadId: "1234567890",
    messages: [
      {
        messageId: "msg123",
        content: "Test message",
        timestamp: 1704067200000,
        authorId: "user123",
      },
    ],
  };

  const result = validateThreadQueue(validData);
  assertEquals(result, validData);
});

Deno.test("parseJsonSafe - 有効なJSONを解析", () => {
  const json = JSON.stringify({
    threadId: "1234567890",
    repositoryFullName: null,
    repositoryLocalPath: null,
    worktreePath: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    lastActiveAt: "2024-01-01T00:00:00.000Z",
    status: "active",
  });

  const result = parseJsonSafe(json, ThreadInfoSchema);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.threadId, "1234567890");
  }
});

Deno.test("parseJsonSafe - 無効なJSONで失敗", () => {
  const json = "invalid json";
  const result = parseJsonSafe(json, ThreadInfoSchema);
  assertEquals(result.success, false);
});

Deno.test("parseJsonlSafe - 有効なJSONLを解析", () => {
  const jsonl = [
    JSON.stringify({
      timestamp: "2024-01-01T00:00:00.000Z",
      sessionId: "session123",
      type: "request",
      content: "Request 1",
    }),
    JSON.stringify({
      timestamp: "2024-01-01T00:01:00.000Z",
      sessionId: "session123",
      type: "response",
      content: "Response 1",
    }),
  ].join("\n");

  const result = parseJsonlSafe(jsonl, SessionLogSchema);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.length, 2);
    assertEquals(result.data[0].type, "request");
    assertEquals(result.data[1].type, "response");
  }
});

Deno.test("parseJsonlSafe - 一部無効な行がある場合", () => {
  const jsonl = [
    JSON.stringify({
      timestamp: "2024-01-01T00:00:00.000Z",
      sessionId: "session123",
      type: "request",
      content: "Valid line",
    }),
    "invalid json line",
    JSON.stringify({
      timestamp: "invalid-date",
      sessionId: "session123",
      type: "request",
      content: "Invalid timestamp",
    }),
  ].join("\n");

  const result = parseJsonlSafe(jsonl, SessionLogSchema);
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.issues.length, 2);
  }
});

Deno.test("repositoryFullName形式の検証", () => {
  const validNames = [
    "owner/repo",
    "owner-123/repo_name",
    "OWNER/REPO",
    "owner.name/repo.name",
  ];

  for (const name of validNames) {
    const data = {
      threadId: "1234567890",
      repositoryFullName: name,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T00:00:00.000Z",
      status: "active" as const,
    };
    const result = ThreadInfoSchema.safeParse(data);
    assertEquals(result.success, true, `Failed for: ${name}`);
  }

  const invalidNames = [
    "owner",
    "/repo",
    "owner/",
    "owner//repo",
    "owner/repo/sub",
    "owner repo",
  ];

  for (const name of invalidNames) {
    const data = {
      threadId: "1234567890",
      repositoryFullName: name,
      repositoryLocalPath: null,
      worktreePath: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActiveAt: "2024-01-01T00:00:00.000Z",
      status: "active" as const,
    };
    const result = ThreadInfoSchema.safeParse(data);
    assertEquals(result.success, false, `Should fail for: ${name}`);
  }
});

Deno.test("AuditEntryのdetailsフィールドは任意の構造を受け入れる", () => {
  const testCases = [
    { simple: "value" },
    { nested: { level1: { level2: "value" } } },
    { array: [1, 2, 3] },
    { mixed: { str: "text", num: 123, bool: true, nullVal: null } },
    {},
  ];

  for (const details of testCases) {
    const data = {
      timestamp: "2024-01-01T00:00:00.000Z",
      threadId: "1234567890",
      action: "test_action",
      details,
    };
    const result = AuditEntrySchema.safeParse(data);
    assertEquals(result.success, true);
  }
});
