/**
 * Worker名生成に使用する形容詞のリスト
 * ポジティブで親しみやすい形容詞を選定しており、
 * 生成されるWorker名が親しみやすく記憶しやすいものになるよう配慮されている
 */
const adjectives = [
  "happy",
  "clever",
  "gentle",
  "brave",
  "swift",
  "wise",
  "bold",
  "calm",
  "eager",
  "fair",
  "keen",
  "kind",
  "noble",
  "proud",
  "quiet",
  "sharp",
  "smart",
  "strong",
  "warm",
  "young",
];

/**
 * Worker名生成に使用する動物名のリスト
 * 一般的に知られている動物を選定しており、
 * 生成されるWorker名が視覚的にイメージしやすいものになるよう配慮されている
 */
const animals = [
  "panda",
  "fox",
  "bear",
  "wolf",
  "lion",
  "tiger",
  "eagle",
  "hawk",
  "dove",
  "owl",
  "deer",
  "rabbit",
  "otter",
  "seal",
  "whale",
  "shark",
  "dolphin",
  "crow",
  "raven",
  "swan",
];

/**
 * ランダムなWorker名を生成する
 *
 * 形容詞と動物名をランダムに組み合わせて、ハイフンで結合したユニークな名前を生成します。
 * 生成される名前の形式は "{形容詞}-{動物}" となります。
 * 例: "happy-panda", "clever-fox", "brave-lion"
 *
 * この名前生成方式により、以下の利点があります：
 * - 記憶しやすく親しみやすい名前
 * - ログやデバッグ時に識別しやすい
 * - UUIDなどと比較して人間が読みやすい
 *
 * @returns {string} 生成されたWorker名（形式: "{形容詞}-{動物}"）
 * @example
 * const workerName = generateWorkerName();
 * console.log(workerName); // "gentle-dolphin"
 */
export function generateWorkerName(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adjective}-${animal}`;
}
