// Discord メッセージ出力分割ユーティリティ
// 長いテキストを Discord の制限に合わせて分割し、コードブロックを維持

/**
 * メッセージ分割の設定
 */
export interface MessageSplitOptions {
  /** 1メッセージあたりの最大文字数 */
  maxLength?: number;
  /** コードブロックを維持するかどうか */
  preserveCodeBlocks?: boolean;
  /** 分割メッセージに番号を付与するかどうか */
  addMessageNumbers?: boolean;
  /** 分割時のプレフィックス */
  messagePrefix?: string;
}

/**
 * 分割されたメッセージの情報
 */
export interface SplitMessage {
  /** メッセージ内容 */
  content: string;
  /** メッセージ番号（1から開始） */
  messageNumber: number;
  /** 総メッセージ数 */
  totalMessages: number;
  /** コードブロック内の分割かどうか */
  isPartialCodeBlock: boolean;
}

/**
 * コードブロックの情報
 */
interface CodeBlock {
  /** 開始位置 */
  start: number;
  /** 終了位置 */
  end: number;
  /** 言語指定 */
  language: string;
  /** コードブロック内容 */
  content: string;
}

/**
 * 長いテキストを Discord の制限に合わせて分割
 * @param text 分割対象のテキスト
 * @param options 分割オプション
 * @returns 分割されたメッセージの配列
 */
export function splitMessage(
  text: string,
  options: MessageSplitOptions = {},
): SplitMessage[] {
  const {
    maxLength = 1900,
    preserveCodeBlocks = true,
    addMessageNumbers = true,
    messagePrefix = '',
  } = options;

  // 空文字の場合は空配列を返す
  if (!text.trim()) {
    return [];
  }

  // コードブロックを検出
  const codeBlocks = preserveCodeBlocks ? detectCodeBlocks(text) : [];

  // テキストを分割
  const chunks = splitTextIntoChunks(text, maxLength, codeBlocks);

  // SplitMessage オブジェクトの配列に変換
  const messages: SplitMessage[] = chunks.map((chunk, index) => ({
    content: addMessageNumbers && chunks.length > 1
      ? `${messagePrefix}**[${index + 1}/${chunks.length}]**\n${chunk}`
      : `${messagePrefix}${chunk}`,
    messageNumber: index + 1,
    totalMessages: chunks.length,
    isPartialCodeBlock: chunk.includes('```') && !isCompleteCodeBlock(chunk),
  }));

  return messages;
}

/**
 * テキスト内のコードブロックを検出
 * @param text 検索対象のテキスト
 * @returns コードブロックの配列
 */
function detectCodeBlocks(text: string): CodeBlock[] {
  const codeBlocks: CodeBlock[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    codeBlocks.push({
      start: match.index,
      end: match.index + match[0].length,
      language: match[1] || '',
      content: match[2] || '',
    });
  }

  return codeBlocks;
}

/**
 * テキストを指定された長さのチャンクに分割
 * @param text 分割対象のテキスト
 * @param maxLength 最大文字数
 * @param codeBlocks コードブロックの配列
 * @returns 分割されたテキストの配列
 */
function splitTextIntoChunks(
  text: string,
  maxLength: number,
  codeBlocks: CodeBlock[],
): string[] {
  const chunks: string[] = [];
  let currentPosition = 0;

  while (currentPosition < text.length) {
    const remainingText = text.substring(currentPosition);

    if (remainingText.length <= maxLength) {
      // 残りのテキストが制限内に収まる場合
      chunks.push(remainingText);
      break;
    }

    // 制限内で分割点を見つける
    const splitPoint = findOptimalSplitPoint(
      remainingText,
      maxLength,
      codeBlocks,
      currentPosition,
    );

    const chunk = remainingText.substring(0, splitPoint);
    chunks.push(chunk);
    currentPosition += splitPoint;
  }

  return chunks;
}

/**
 * 最適な分割点を見つける
 * @param text 分割対象のテキスト
 * @param maxLength 最大文字数
 * @param codeBlocks コードブロックの配列
 * @param textOffset テキスト全体における現在位置のオフセット
 * @returns 分割点の位置
 */
function findOptimalSplitPoint(
  text: string,
  maxLength: number,
  codeBlocks: CodeBlock[],
  textOffset: number,
): number {
  // コードブロック内かどうかを判定
  const currentCodeBlock = findCodeBlockAt(textOffset, codeBlocks);

  if (currentCodeBlock) {
    // コードブロック内の場合
    return handleCodeBlockSplit(text, maxLength, currentCodeBlock, textOffset);
  }

  // 通常のテキストの場合、改行で分割を試みる
  let splitPoint = maxLength;

  // 最後の改行を探す
  const lastNewline = text.lastIndexOf('\n', maxLength);
  if (lastNewline > maxLength * 0.5) {
    // 分割点が後半にある場合は改行で分割
    splitPoint = lastNewline + 1;
  } else {
    // 改行が見つからない or 前半すぎる場合は空白で分割
    const lastSpace = text.lastIndexOf(' ', maxLength);
    if (lastSpace > maxLength * 0.8) {
      splitPoint = lastSpace + 1;
    }
  }

  return Math.min(splitPoint, text.length);
}

/**
 * 指定位置にあるコードブロックを検索
 * @param position 検索位置
 * @param codeBlocks コードブロックの配列
 * @returns 該当するコードブロック（なければnull）
 */
function findCodeBlockAt(position: number, codeBlocks: CodeBlock[]): CodeBlock | null {
  return codeBlocks.find((block) => position >= block.start && position < block.end) || null;
}

/**
 * コードブロック内での分割を処理
 * @param text 分割対象のテキスト
 * @param maxLength 最大文字数
 * @param codeBlock 現在のコードブロック
 * @param textOffset テキスト全体における現在位置のオフセット
 * @returns 分割点の位置
 */
function handleCodeBlockSplit(
  text: string,
  maxLength: number,
  codeBlock: CodeBlock,
  textOffset: number,
): number {
  const codeBlockEnd = codeBlock.end - textOffset;

  if (codeBlockEnd <= maxLength) {
    // コードブロック全体が制限内に収まる場合
    return codeBlockEnd;
  }

  // コードブロックを分割する必要がある場合
  // ```で終わることを考慮して、適切な分割点を見つける
  const availableLength = maxLength - 6; // "```\n" の分を差し引く

  // 改行で分割を試みる
  const lastNewline = text.lastIndexOf('\n', availableLength);
  if (lastNewline > 0) {
    return lastNewline + 1;
  }

  // 改行がない場合は強制的に分割
  return availableLength;
}

/**
 * テキストが完全なコードブロックかどうかを判定
 * @param text 判定対象のテキスト
 * @returns 完全なコードブロックの場合はtrue
 */
function isCompleteCodeBlock(text: string): boolean {
  const codeBlockMatches = text.match(/```/g);
  return codeBlockMatches ? codeBlockMatches.length % 2 === 0 : true;
}

/**
 * コードブロックが分割された場合に、適切な開始/終了マーカーを追加
 * @param chunks 分割されたテキストの配列
 * @param originalText 元のテキスト
 * @returns マーカーが追加されたテキストの配列
 */
export function addCodeBlockMarkers(chunks: string[], originalText: string): string[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const codeBlocks = detectCodeBlocks(originalText);
  if (codeBlocks.length === 0) {
    return chunks;
  }

  return chunks.map((chunk, index) => {
    const isPartial = !isCompleteCodeBlock(chunk);

    if (!isPartial) {
      return chunk;
    }

    // 部分的なコードブロックの場合、適切なマーカーを追加
    let modifiedChunk = chunk;

    // 最初のチャンクでない場合、コードブロック開始マーカーを追加
    if (index > 0 && chunk.includes('```') && !chunk.startsWith('```')) {
      // 想定される言語を推測（簡易版）
      const language = inferLanguageFromContext(chunk);
      modifiedChunk = `\`\`\`${language}\n${modifiedChunk}`;
    }

    // 最後のチャンクでない場合、コードブロック終了マーカーを追加
    if (index < chunks.length - 1 && chunk.includes('```') && !chunk.endsWith('```')) {
      modifiedChunk = `${modifiedChunk}\n\`\`\``;
    }

    return modifiedChunk;
  });
}

/**
 * コンテキストから言語を推測（簡易版）
 * @param content コードブロックの内容
 * @returns 推測された言語
 */
function inferLanguageFromContext(content: string): string {
  // 一般的なキーワードから言語を推測
  const keywords = {
    'typescript': ['function', 'interface', 'type', 'export', 'import'],
    'javascript': ['function', 'const', 'let', 'var', 'require'],
    'python': ['def', 'import', 'from', 'class', 'if __name__'],
    'bash': ['#!/bin/bash', 'echo', 'mkdir', 'cd', '$'],
    'json': ['{', '":', 'null', 'true', 'false'],
  };

  for (const [language, languageKeywords] of Object.entries(keywords)) {
    const score = languageKeywords.reduce((acc, keyword) => {
      return acc + (content.includes(keyword) ? 1 : 0);
    }, 0);

    if (score >= 2) {
      return language;
    }
  }

  return ''; // 言語が推測できない場合は空文字
}

/**
 * 分割されたメッセージを結合（デバッグ用）
 * @param messages 分割されたメッセージの配列
 * @returns 結合されたテキスト
 */
export function joinSplitMessages(messages: SplitMessage[]): string {
  return messages
    .map((msg) => msg.content)
    .join('\n\n--- MESSAGE SPLIT ---\n\n');
}
