import { GitRepository } from "./git-utils.ts";

export interface IWorker {
  processMessage(message: string): Promise<string>;
  getName(): string;
  getRepository(): GitRepository | null;
  setRepository(repository: GitRepository, localPath: string): void;
}

export class Worker implements IWorker {
  private readonly name: string;
  private repository: GitRepository | null = null;

  constructor(name: string) {
    this.name = name;
  }

  processMessage(message: string): Promise<string> {
    const repoInfo = this.repository
      ? `（現在のリポジトリ: ${this.repository.fullName}）`
      : "（リポジトリ未設定）";

    return Promise.resolve(
      `こんにちは、${this.name}です。${message}というメッセージを受け取りました！${repoInfo}`,
    );
  }

  getName(): string {
    return this.name;
  }

  getRepository(): GitRepository | null {
    return this.repository;
  }

  setRepository(repository: GitRepository, _localPath: string): void {
    this.repository = repository;
    // _localPath は将来的にファイル操作で使用予定
  }
}
