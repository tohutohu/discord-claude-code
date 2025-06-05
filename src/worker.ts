export interface IWorker {
  processMessage(message: string): Promise<string>;
  getName(): string;
}

export class Worker implements IWorker {
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  processMessage(message: string): Promise<string> {
    return Promise.resolve(
      `こんにちは、${this.name}です。${message}というメッセージを受け取りました！`,
    );
  }

  getName(): string {
    return this.name;
  }
}
