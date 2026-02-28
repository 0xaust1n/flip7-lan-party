import { Card, ActionCard } from "./types";

export function createDeck(): Card[] {
  const deck: Card[] = [];

  // Official distribution:
  // 0: 1 card
  // 1: 1 card
  // 2: 2 cards
  // 3: 3 cards
  // ...
  // 12: 12 cards
  // Total number cards: 1 + 1 + 2 + 3 + ... + 12 = 1 + (12*13)/2 = 79 cards

  deck.push({ kind: "number", value: 0 });
  for (let value = 1; value <= 12; value += 1) {
    const count = value;
    for (let i = 0; i < count; i += 1) {
      deck.push({ kind: "number", value });
    }
  }

  // Action cards:
  // 3 Freeze
  // 3 Flip Three
  // 3 Second Chance
  // Total: 9 cards
  ["freeze", "flip_three", "second_chance"].forEach((action) => {
    for (let i = 0; i < 3; i += 1) {
      deck.push({ kind: "action", action: action as ActionCard["action"] });
    }
  });

  // Modifier cards:
  // +2, +4, +6, +8, +10 (one each)
  // x2 (one)
  // Total: 6 cards
  [2, 4, 6, 8, 10].forEach((value) => {
    deck.push({ kind: "modifier", modifier: "plus", value });
  });
  deck.push({ kind: "modifier", modifier: "x2" });

  // Total Deck Size: 79 + 9 + 6 = 94 cards.
  return shuffle(deck);
}

export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function secureRandomInt(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const maxUint32 = 0x100000000;
  const cutoff = Math.floor(maxUint32 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buffer);
    const value = buffer[0];
    if (value < cutoff) {
      return value % maxExclusive;
    }
  }
}
