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

export function generateWorkerName(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adjective}-${animal}`;
}
