export type NumberCard = { kind: "number"; value: number };
export type ActionCard = { kind: "action"; action: "freeze" | "flip_three" | "second_chance" };
export type ModifierCard = { kind: "modifier"; modifier: "plus" | "x2"; value?: number };
export type Card = NumberCard | ActionCard | ModifierCard;
export type GameLocale = "zh-Hant" | "en";

export type PendingFreezeState = {
  chooserPlayerId: string;
  resumeFromPlayerId: string;
  expiresAt: number;
};

export type PendingQueuedAction = {
  action: "freeze" | "flip_three";
  chooserPlayerId: string;
  resumeFromPlayerId: string;
};

export type SecondChanceStats = {
  appearedCount: number;
  blockedNumbers: number[];
  discardPile: string[];
};

export type PlayerState = {
  id: string;
  name: string;
  cards: string[];
  numberCards: number[];
  modifierBonus: number;
  hasX2: boolean;
  secondChance: boolean;
  passBonus: number;
  roundScore: number;
  totalScore: number;
  busted: boolean;
  passed: boolean;
};

export type WinnerState = {
  playerId: string;
  name: string;
  totalScore: number;
};

export type InternalGameState = {
  room: string;
  locale: GameLocale;
  round: number;
  gameStarted: boolean;
  adminPlayerId: string | null;
  pendingFreeze: PendingFreezeState | null;
  pendingActionQueue: PendingQueuedAction[];
  pendingFlipThree: {
    sourcePlayerId: string;
    resumeFromPlayerId: string;
  } | null;
  players: PlayerState[];
  turnOrder: string[];
  currentTurnPlayerId: string | null;
  turnStartedAt: number | null; // For the 30s timer
  deck: Card[];
  secondChanceStats: SecondChanceStats;
  message: string;
  winner: WinnerState | null;
  updatedAt: number;
};

export type PublicGameState = {
  room: string;
  locale: GameLocale;
  round: number;
  gameStarted: boolean;
  adminPlayerId: string | null;
  pendingFreeze: { chooserPlayerId: string; expiresAt: number } | null;
  pendingFlipThree: {
    sourcePlayerId: string;
  } | null;
  players: PlayerState[];
  turnOrder: string[];
  currentTurnPlayerId: string | null;
  turnStartedAt: number | null;
  deckCount: number;
  secondChanceStats: SecondChanceStats;
  message: string;
  winner: WinnerState | null;
  updatedAt: number;
};

export type ClientAction =
  | { type: "action"; action: "addPlayer"; payload: { name: string } }
  | { type: "action"; action: "renamePlayer"; payload: { playerId: string; name: string } }
  | { type: "action"; action: "startGame" }
  | { type: "action"; action: "dealSelf" }
  | { type: "action"; action: "passSelf" }
  | { type: "action"; action: "resolveFreezeTarget"; payload: { targetPlayerId: string } }
  | { type: "action"; action: "selectFlipThreeTarget"; payload: { targetPlayerId: string } }
  | { type: "action"; action: "startNewRound" }
  | { type: "action"; action: "resetGame" };

export type ActionClientData = {
  room: string;
  clientId: string;
  claimedPlayerId: string | null;
  locale?: GameLocale;
};

export type ApplyActionContext = {
  actor: ActionClientData;
  getRoomPlayerByClient: (room: string) => Map<string, string>;
  clearRoomPlayerOwnership: (room: string) => void;
};
