// WorkspaceManager関連のエラー型定義
export type WorkspaceError =
  | { type: "THREAD_NOT_FOUND"; threadId: string }
  | { type: "THREAD_SAVE_FAILED"; threadId: string; error: string }
  | { type: "THREAD_LOAD_FAILED"; threadId: string; error: string }
  | { type: "THREAD_UPDATE_FAILED"; threadId: string; error: string }
  | { type: "THREAD_LIST_FAILED"; error: string }
  | { type: "THREAD_INITIALIZATION_FAILED"; error: string }
  | {
    type: "SESSION_SAVE_FAILED";
    repositoryFullName: string;
    sessionId: string;
    error: string;
  }
  | {
    type: "SESSION_LOAD_FAILED";
    repositoryFullName: string;
    sessionId: string;
    error: string;
  }
  | {
    type: "SESSION_LIST_FAILED";
    repositoryFullName: string;
    error: string;
  }
  | {
    type: "SESSION_DELETE_FAILED";
    repositoryFullName: string;
    sessionId: string;
    error: string;
  }
  | {
    type: "SESSION_INITIALIZATION_FAILED";
    error: string;
  }
  | { type: "AUDIT_LOG_FAILED"; action: string; error: string }
  | { type: "PAT_NOT_FOUND"; repositoryFullName: string }
  | { type: "PAT_SAVE_FAILED"; repositoryFullName: string; error: string }
  | { type: "PAT_DELETE_FAILED"; repositoryFullName: string; error: string }
  | { type: "QUEUE_NOT_FOUND"; threadId: string }
  | { type: "QUEUE_SAVE_FAILED"; threadId: string; error: string }
  | { type: "ADMIN_STATE_LOAD_FAILED"; error: string }
  | { type: "ADMIN_STATE_SAVE_FAILED"; error: string }
  | { type: "WORKER_STATE_NOT_FOUND"; threadId: string }
  | { type: "WORKER_STATE_SAVE_FAILED"; threadId: string; error: string }
  | { type: "REPOSITORY_READ_FAILED"; error: string }
  | { type: "WORKTREE_CREATE_FAILED"; threadId: string; error: string }
  | { type: "WORKTREE_REMOVE_FAILED"; threadId: string; error: string }
  | { type: "DIRECTORY_CREATE_FAILED"; path: string; error: string }
  | { type: "FILE_READ_FAILED"; path: string; error: string }
  | { type: "FILE_WRITE_FAILED"; path: string; error: string };
