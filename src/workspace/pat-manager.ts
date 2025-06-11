import { join } from "std/path/mod.ts";
import { ensureDir } from "std/fs/mod.ts";
import { err, ok, Result } from "neverthrow";
import type { RepositoryPatInfo } from "../workspace.ts";
import type { WorkspaceError } from "./types.ts";

export class PatManager {
  private readonly patsDir: string;

  constructor(baseDir: string) {
    this.patsDir = join(baseDir, "pats");
  }

  async initialize(): Promise<Result<void, WorkspaceError>> {
    try {
      await ensureDir(this.patsDir);
      return ok(undefined);
    } catch (error) {
      return err({
        type: "DIRECTORY_CREATE_FAILED",
        path: this.patsDir,
        error: `PatManagerの初期化に失敗しました: ${error}`,
      });
    }
  }

  private getPatFilePath(repositoryFullName: string): string {
    const safeName = repositoryFullName.replace(/\//g, "_");
    return join(this.patsDir, `${safeName}.json`);
  }

  async saveRepositoryPat(
    patInfo: RepositoryPatInfo,
  ): Promise<Result<void, WorkspaceError>> {
    try {
      const filePath = this.getPatFilePath(patInfo.repositoryFullName);
      patInfo.updatedAt = new Date().toISOString();
      await Deno.writeTextFile(filePath, JSON.stringify(patInfo, null, 2));
      return ok(undefined);
    } catch (error) {
      return err({
        type: "PAT_SAVE_FAILED",
        repositoryFullName: patInfo.repositoryFullName,
        error: `PAT情報の保存に失敗しました: ${error}`,
      });
    }
  }

  async loadRepositoryPat(
    repositoryFullName: string,
  ): Promise<Result<RepositoryPatInfo | null, WorkspaceError>> {
    try {
      const filePath = this.getPatFilePath(repositoryFullName);
      const content = await Deno.readTextFile(filePath);
      return ok(JSON.parse(content) as RepositoryPatInfo);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok(null);
      }
      return err({
        type: "FILE_READ_FAILED",
        path: this.getPatFilePath(repositoryFullName),
        error: `PAT情報の読み込みに失敗しました: ${error}`,
      });
    }
  }

  async deleteRepositoryPat(
    repositoryFullName: string,
  ): Promise<Result<void, WorkspaceError>> {
    const filePath = this.getPatFilePath(repositoryFullName);
    try {
      await Deno.remove(filePath);
      return ok(undefined);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // ファイルが存在しない場合は成功とみなす
        return ok(undefined);
      }
      return err({
        type: "PAT_DELETE_FAILED",
        repositoryFullName,
        error: `PAT情報の削除に失敗しました: ${error}`,
      });
    }
  }

  async listRepositoryPats(): Promise<
    Result<RepositoryPatInfo[], WorkspaceError>
  > {
    try {
      const pats: RepositoryPatInfo[] = [];

      for await (const entry of Deno.readDir(this.patsDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const filePath = join(this.patsDir, entry.name);
          try {
            const content = await Deno.readTextFile(filePath);
            pats.push(JSON.parse(content) as RepositoryPatInfo);
          } catch (error) {
            // 個別のファイル読み込みエラーはログに記録して続行
            console.error(`PAT情報の読み込みエラー (${entry.name}):`, error);
          }
        }
      }

      return ok(
        pats.sort((a, b) =>
          a.repositoryFullName.localeCompare(b.repositoryFullName)
        ),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return ok([]);
      }
      return err({
        type: "FILE_READ_FAILED",
        path: this.patsDir,
        error: `PAT情報一覧の取得に失敗しました: ${error}`,
      });
    }
  }

  async updatePatDescription(
    repositoryFullName: string,
    description: string,
  ): Promise<Result<void, WorkspaceError>> {
    const loadResult = await this.loadRepositoryPat(repositoryFullName);
    if (loadResult.isErr()) {
      return err(loadResult.error);
    }

    const patInfo = loadResult.value;
    if (!patInfo) {
      return err({
        type: "PAT_NOT_FOUND",
        repositoryFullName,
      });
    }

    patInfo.description = description;
    return await this.saveRepositoryPat(patInfo);
  }

  async isPatExpired(
    repositoryFullName: string,
    expiryDays: number,
  ): Promise<Result<boolean, WorkspaceError>> {
    const loadResult = await this.loadRepositoryPat(repositoryFullName);
    if (loadResult.isErr()) {
      return err(loadResult.error);
    }

    const patInfo = loadResult.value;
    if (!patInfo) {
      return ok(true);
    }

    const createdDate = new Date(patInfo.createdAt);
    const expiryDate = new Date(createdDate);
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    return ok(new Date() > expiryDate);
  }

  async cleanupExpiredPats(
    expiryDays: number,
  ): Promise<Result<string[], WorkspaceError>> {
    const listResult = await this.listRepositoryPats();
    if (listResult.isErr()) {
      return err(listResult.error);
    }

    const allPats = listResult.value;
    const deletedPats: string[] = [];

    for (const patInfo of allPats) {
      const expiredResult = await this.isPatExpired(
        patInfo.repositoryFullName,
        expiryDays,
      );
      if (expiredResult.isErr()) {
        // エラーはログに記録して続行
        console.error(
          `PAT期限チェックエラー (${patInfo.repositoryFullName}):`,
          expiredResult.error,
        );
        continue;
      }

      if (expiredResult.value) {
        const deleteResult = await this.deleteRepositoryPat(
          patInfo.repositoryFullName,
        );
        if (deleteResult.isOk()) {
          deletedPats.push(patInfo.repositoryFullName);
        } else {
          // 削除エラーはログに記録して続行
          console.error(
            `PAT削除エラー (${patInfo.repositoryFullName}):`,
            deleteResult.error,
          );
        }
      }
    }

    return ok(deletedPats);
  }
}
