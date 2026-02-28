import {
  InternalGameState,
  PublicGameState,
  ClientAction,
  ApplyActionContext,
  PlayerState,
  PendingQueuedAction,
  Card,
  WinnerState,
  NumberCard,
  ActionCard
} from "./types";
import { createDeck, shuffle } from "./deck";

export * from "./types";

const MAX_PLAYERS = 6;
const WINNING_SCORE = 200;
const FREEZE_TARGET_TIMEOUT_MS = 15000;
export const TURN_TIMEOUT_MS = 30000;

function createPlayer(name: string): PlayerState {
  return {
    id: crypto.randomUUID(),
    name,
    cards: [],
    numberCards: [],
    modifierBonus: 0,
    hasX2: false,
    secondChance: false,
    passBonus: 0,
    roundScore: 0,
    totalScore: 0,
    busted: false,
    passed: false
  };
}

export function createInitialState(room: string): InternalGameState {
  return {
    room,
    round: 0,
    gameStarted: false,
    adminPlayerId: null,
    pendingFreeze: null,
    pendingActionQueue: [],
    pendingFlipThree: null,
    players: [],
    turnOrder: [],
    currentTurnPlayerId: null,
    turnStartedAt: null,
    deck: createDeck(),
    secondChanceStats: {
      appearedCount: 0,
      blockedNumbers: [],
      discardPile: []
    },
    message: "歡迎來到 Flip 7，請先加入玩家並由房主開始新局。",
    winner: null,
    updatedAt: Date.now()
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function isPlayable(player: PlayerState): boolean {
  return !player.busted && !player.passed;
}

function normalizeTurnOrder(state: InternalGameState): void {
  const validIds = new Set(state.players.map((p) => p.id));
  state.turnOrder = state.turnOrder.filter((id) => validIds.has(id));
  state.players.forEach((player) => {
    if (!state.turnOrder.includes(player.id)) {
      state.turnOrder.push(player.id);
    }
  });
}

function getPlayerById(state: InternalGameState, playerId: string | null): PlayerState | null {
  if (!playerId) return null;
  return state.players.find((p) => p.id === playerId) || null;
}

function getNextTurnPlayerId(state: InternalGameState, currentPlayerId: string | null): string | null {
  normalizeTurnOrder(state);
  if (state.turnOrder.length === 0) return null;

  const startIdx = currentPlayerId ? state.turnOrder.indexOf(currentPlayerId) : -1;
  for (let i = 1; i <= state.turnOrder.length; i += 1) {
    const idx = (startIdx + i + state.turnOrder.length) % state.turnOrder.length;
    const candidateId = state.turnOrder[idx];
    const candidate = getPlayerById(state, candidateId);
    if (candidate && isPlayable(candidate)) return candidate.id;
  }
  return null;
}

function ensureCurrentTurn(state: InternalGameState): void {
  if (!state.gameStarted) {
    state.currentTurnPlayerId = null;
    state.turnStartedAt = null;
    return;
  }
  if (state.pendingFreeze) {
    state.currentTurnPlayerId = state.pendingFreeze.chooserPlayerId;
    return;
  }
  if (state.pendingFlipThree) {
    state.currentTurnPlayerId = state.pendingFlipThree.sourcePlayerId;
    return;
  }
  const current = getPlayerById(state, state.currentTurnPlayerId);
  if (current && isPlayable(current)) {
    return;
  }
  state.currentTurnPlayerId = getNextTurnPlayerId(state, state.currentTurnPlayerId);
  if (state.currentTurnPlayerId) {
    state.turnStartedAt = Date.now();
  } else {
    state.turnStartedAt = null;
  }
}

function advanceTurn(state: InternalGameState): void {
  state.currentTurnPlayerId = getNextTurnPlayerId(state, state.currentTurnPlayerId);
  if (state.currentTurnPlayerId) {
    state.turnStartedAt = Date.now();
  } else {
    state.turnStartedAt = null;
  }
}

function enqueuePendingAction(
  state: InternalGameState,
  action: PendingQueuedAction,
  insertToFront = false
): void {
  if (insertToFront) {
    state.pendingActionQueue.unshift(action);
    return;
  }
  state.pendingActionQueue.push(action);
}

function promoteNextPendingAction(state: InternalGameState): string[] {
  const droppedMessages: string[] = [];
  if (state.pendingFreeze || state.pendingFlipThree) return droppedMessages;

  while (state.pendingActionQueue.length > 0) {
    const next = state.pendingActionQueue.shift()!;
    const chooser = getPlayerById(state, next.chooserPlayerId);
    if (!chooser || !isPlayable(chooser)) {
      droppedMessages.push(`已棄置動作牌：${next.action === "freeze" ? "凍結" : "翻三張"}（玩家已非 active）。`);
      continue;
    }

    if (next.action === "freeze") {
      state.pendingFreeze = {
        chooserPlayerId: next.chooserPlayerId,
        resumeFromPlayerId: next.resumeFromPlayerId,
        expiresAt: Date.now() + FREEZE_TARGET_TIMEOUT_MS
      };
      return droppedMessages;
    }

    state.pendingFlipThree = {
      sourcePlayerId: next.chooserPlayerId,
      resumeFromPlayerId: next.resumeFromPlayerId
    };
    return droppedMessages;
  }

  return droppedMessages;
}

function getActivePlayers(state: InternalGameState): PlayerState[] {
  return state.players.filter((player) => isPlayable(player));
}

function appendSecondChanceDiscardEntry(state: InternalGameState, entry: string): void {
  state.secondChanceStats.discardPile.push(entry);
  if (state.secondChanceStats.discardPile.length > 80) {
    state.secondChanceStats.discardPile.splice(0, state.secondChanceStats.discardPile.length - 80);
  }
}

function markSecondChanceAppeared(state: InternalGameState, playerName: string): void {
  state.secondChanceStats.appearedCount += 1;
  appendSecondChanceDiscardEntry(state, `${playerName} 抽到第二次機會`);
}

function markSecondChanceBlockedNumber(state: InternalGameState, playerName: string, value: number): void {
  state.secondChanceStats.blockedNumbers.push(value);
  if (state.secondChanceStats.blockedNumbers.length > 80) {
    state.secondChanceStats.blockedNumbers.splice(0, state.secondChanceStats.blockedNumbers.length - 80);
  }
  appendSecondChanceDiscardEntry(state, `${playerName} 第二次機會擋下 ${value}`);
}

function pickFreezeFallbackTarget(state: InternalGameState, chooserPlayerId: string): PlayerState | null {
  const active = getActivePlayers(state);
  if (active.length === 0) return null;
  const chooser = active.find((player) => player.id === chooserPlayerId);
  return chooser || active[0];
}

function hasFlip7(player: PlayerState): boolean {
  return player.numberCards.length >= 7;
}

function pickSecondChanceTransferTarget(state: InternalGameState, fromPlayerId: string): PlayerState | null {
  normalizeTurnOrder(state);
  if (state.turnOrder.length === 0) return null;
  const startIdx = state.turnOrder.indexOf(fromPlayerId);

  for (let i = 1; i <= state.turnOrder.length; i += 1) {
    const idx = (startIdx + i + state.turnOrder.length) % state.turnOrder.length;
    const candidate = getPlayerById(state, state.turnOrder[idx]);
    if (!candidate || candidate.id === fromPlayerId) continue;
    if (!isPlayable(candidate)) continue;
    if (candidate.secondChance) continue;
    return candidate;
  }
  return null;
}

function handleSecondChanceDraw(state: InternalGameState, player: PlayerState): string {
  markSecondChanceAppeared(state, player.name);

  if (!player.secondChance) {
    player.secondChance = true;
    player.cards.push("第二次機會");
    return `${player.name} 獲得「第二次機會」。`;
  }

  const transferTarget = pickSecondChanceTransferTarget(state, player.id);
  if (!transferTarget) {
    appendSecondChanceDiscardEntry(state, `${player.name} 重複第二次機會無法轉交，棄牌`);
    return `${player.name} 抽到「第二次機會」，但沒有可轉交的 active 玩家，故棄牌。`;
  }

  transferTarget.secondChance = true;
  transferTarget.cards.push("第二次機會");
  appendSecondChanceDiscardEntry(state, `${player.name} 的重複第二次機會轉交給 ${transferTarget.name}`);
  return `${player.name} 抽到重複「第二次機會」，轉交給 ${transferTarget.name}。`;
}

function resolvePendingFreezeEffect(state: InternalGameState, requestedTargetId: string | null): string {
  const pending = state.pendingFreeze;
  if (!pending) return "目前沒有待指定的凍結效果。";

  const chooser = getPlayerById(state, pending.chooserPlayerId);
  let target = requestedTargetId ? getPlayerById(state, requestedTargetId) : null;
  let usedFallback = false;
  if (!target || !isPlayable(target)) {
    usedFallback = true;
    target = pickFreezeFallbackTarget(state, pending.chooserPlayerId);
  }

  let message = "";
  if (!target) {
    message = `${chooser?.name || "玩家"} 的凍結沒有有效目標，效果略過。`;
  } else {
    target.passed = true;
    target.passBonus = 0;
    recalculateRoundScore(target);
    message = usedFallback
      ? `${chooser?.name || "玩家"} 的凍結目標失效，改為凍結 ${target.name}。${target.name} 本輪已 bank 並退出。`
      : `${chooser?.name || "玩家"} 凍結了 ${target.name}。${target.name} 本輪已 bank 並退出。`;
  }

  state.pendingFreeze = null;
  const dropped = promoteNextPendingAction(state);
  if (!state.pendingFreeze && !state.pendingFlipThree) {
    state.currentTurnPlayerId = pending.resumeFromPlayerId;
    advanceTurn(state);
  }
  if (dropped.length > 0) {
    return `${message} ${dropped.join(" ")}`.trim();
  }
  return message;
}

function resolveExpiredPendingFreeze(state: InternalGameState): string | null {
  if (!state.pendingFreeze) return null;
  if (Date.now() <= state.pendingFreeze.expiresAt) return null;
  return resolvePendingFreezeEffect(state, null);
}

function recalculateRoundScore(player: PlayerState): void {
  if (player.busted) {
    player.roundScore = 0;
    return;
  }
  const base = sum(player.numberCards);
  const multiplied = player.hasX2 ? base * 2 : base;
  const flip7Bonus = hasFlip7(player) ? 15 : 0;
  player.roundScore = multiplied + player.modifierBonus + player.passBonus + flip7Bonus;
}

function resetRoundFields(player: PlayerState): void {
  player.cards = [];
  player.numberCards = [];
  player.modifierBonus = 0;
  player.hasX2 = false;
  player.secondChance = false;
  player.passBonus = 0;
  player.roundScore = 0;
  player.busted = false;
  player.passed = false;
}

function drawFromDeck(state: InternalGameState): Card | null {
  if (state.deck.length === 0) {
    state.deck = createDeck();
  }
  return state.deck.pop() || null;
}

function cardLabel(card: Card): string {
  if (card.kind === "number") return String(card.value);
  if (card.kind === "modifier") return card.modifier === "x2" ? "x2" : `+${card.value}`;
  if (card.action === "freeze") return "凍結";
  if (card.action === "flip_three") return "翻三張";
  return "第二次機會";
}

function removeOneCardLabel(player: PlayerState, label: string): void {
  const idx = player.cards.indexOf(label);
  if (idx >= 0) {
    player.cards.splice(idx, 1);
  }
}

type CardApplyResult = {
  message: string;
  endedByFlip7: boolean;
};

type FlipThreeResolveResult = {
  messages: string[];
  setAsideActions: PendingQueuedAction[];
  endedByFlip7: boolean;
  busted: boolean;
};

function applyNormalCardToPlayer(state: InternalGameState, player: PlayerState, card: Card | null): CardApplyResult {
  if (!card) {
    return { message: `${player.name} 沒有可抽的牌。`, endedByFlip7: false };
  }

  if (card.kind === "number") {
    if (player.numberCards.includes(card.value)) {
      if (player.secondChance) {
        player.secondChance = false;
        removeOneCardLabel(player, "第二次機會");
        markSecondChanceBlockedNumber(state, player.name, card.value);
        recalculateRoundScore(player);
        return {
          message: `${player.name} 抽到重複數字 ${card.value}，但使用了「第二次機會」。`,
          endedByFlip7: false
        };
      }
      player.cards.push(cardLabel(card));
      player.busted = true;
      player.roundScore = 0;
      player.passBonus = 0;
      return { message: `${player.name} 又抽到 ${card.value}，爆牌！`, endedByFlip7: false };
    }

    player.numberCards.push(card.value);
    player.cards.push(cardLabel(card));
    recalculateRoundScore(player);
    if (hasFlip7(player)) {
      return { message: `${player.name} 抽到數字 ${card.value}，達成 Flip 7！本回合立即結束。`, endedByFlip7: true };
    }
    return { message: `${player.name} 抽到數字 ${card.value}。`, endedByFlip7: false };
  }

  if (card.kind === "modifier") {
    if (card.modifier === "x2") {
      player.hasX2 = true;
    } else {
      player.modifierBonus += card.value || 0;
    }
    player.cards.push(cardLabel(card));
    recalculateRoundScore(player);
    return { message: `${player.name} 抽到修正牌 ${cardLabel(card)}。`, endedByFlip7: false };
  }

  if (card.action === "second_chance") {
    const message = handleSecondChanceDraw(state, player);
    return { message, endedByFlip7: false };
  }

  if (card.action === "freeze") {
    player.cards.push("凍結");
    state.pendingFreeze = {
      chooserPlayerId: player.id,
      resumeFromPlayerId: player.id,
      expiresAt: Date.now() + FREEZE_TARGET_TIMEOUT_MS
    };
    return { message: `${player.name} 抽到「凍結」，請指定要凍結的玩家。`, endedByFlip7: false };
  }

  player.cards.push("翻三張");
  state.pendingFlipThree = { sourcePlayerId: player.id, resumeFromPlayerId: player.id };
  return { message: `${player.name} 抽到「翻三張」，請指定一位玩家連翻三張。`, endedByFlip7: false };
}

function resolveFlipThreeSequence(
  state: InternalGameState,
  target: PlayerState,
  resumeFromPlayerId: string
): FlipThreeResolveResult {
  const messages: string[] = [];
  const setAsideActions: PendingQueuedAction[] = [];
  let endedByFlip7 = false;

  for (let i = 0; i < 3; i += 1) {
    if (target.busted || target.passed) break;
    const card = drawFromDeck(state);
    if (!card) {
      messages.push(`${target.name} 沒有可抽的牌。`);
      break;
    }

    if (card.kind === "number") {
      if (target.numberCards.includes(card.value)) {
        if (target.secondChance) {
          target.secondChance = false;
          removeOneCardLabel(target, "第二次機會");
          markSecondChanceBlockedNumber(state, target.name, card.value);
          recalculateRoundScore(target);
          messages.push(`${target.name} 翻到重複數字 ${card.value}，使用了「第二次機會」。`);
          continue;
        }
        target.cards.push(cardLabel(card));
        target.busted = true;
        target.roundScore = 0;
        target.passBonus = 0;
        messages.push(`${target.name} 翻到重複數字 ${card.value}，爆牌。`);
        break;
      }

      target.numberCards.push(card.value);
      target.cards.push(cardLabel(card));
      recalculateRoundScore(target);
      if (hasFlip7(target)) {
        endedByFlip7 = true;
        messages.push(`${target.name} 在翻三張過程達成 Flip 7！`);
        break;
      }
      messages.push(`${target.name} 翻到數字 ${card.value}。`);
      continue;
    }

    if (card.kind === "modifier") {
      if (card.modifier === "x2") {
        target.hasX2 = true;
      } else {
        target.modifierBonus += card.value || 0;
      }
      target.cards.push(cardLabel(card));
      recalculateRoundScore(target);
      messages.push(`${target.name} 翻到修正牌 ${cardLabel(card)}。`);
      continue;
    }

    if (card.action === "second_chance") {
      messages.push(handleSecondChanceDraw(state, target));
      continue;
    }

    setAsideActions.push({
      action: card.action,
      chooserPlayerId: target.id,
      resumeFromPlayerId
    });
    messages.push(
      `${target.name} 翻到「${card.action === "freeze" ? "凍結" : "翻三張"}」，先 set aside。`
    );
  }

  if (target.busted || endedByFlip7) {
    setAsideActions.length = 0;
  }

  return {
    messages,
    setAsideActions,
    endedByFlip7,
    busted: target.busted
  };
}

export function toPublicState(state: InternalGameState): PublicGameState {
  return {
    room: state.room,
    round: state.round,
    gameStarted: state.gameStarted,
    adminPlayerId: state.adminPlayerId,
    pendingFreeze: state.pendingFreeze
      ? {
          chooserPlayerId: state.pendingFreeze.chooserPlayerId,
          expiresAt: state.pendingFreeze.expiresAt
        }
      : null,
    pendingFlipThree: state.pendingFlipThree
      ? {
          sourcePlayerId: state.pendingFlipThree.sourcePlayerId
        }
      : null,
    players: state.players,
    turnOrder: state.turnOrder,
    currentTurnPlayerId: state.currentTurnPlayerId,
    turnStartedAt: state.turnStartedAt,
    deckCount: state.deck.length,
    secondChanceStats: state.secondChanceStats,
    message: state.message,
    winner: state.winner,
    updatedAt: state.updatedAt
  };
}

export function normalizeLoadedState(state: InternalGameState, room: string): InternalGameState {
  state.room = room;
  if (!Array.isArray(state.players)) state.players = [];
  if (!Array.isArray(state.turnOrder)) state.turnOrder = [];
  if (typeof state.gameStarted !== "boolean") state.gameStarted = false;
  if (typeof state.round !== "number" || Number.isNaN(state.round)) {
    state.round = state.gameStarted ? 1 : 0;
  }
  if (typeof state.message !== "string") {
    state.message = "歡迎來到 Flip 7，請先加入玩家並由房主開始新局。";
  }
  if (!Array.isArray(state.deck)) {
    state.deck = createDeck();
  }
  if (
    !state.secondChanceStats ||
    typeof state.secondChanceStats.appearedCount !== "number" ||
    !Array.isArray(state.secondChanceStats.blockedNumbers) ||
    !Array.isArray(state.secondChanceStats.discardPile)
  ) {
    state.secondChanceStats = {
      appearedCount: 0,
      blockedNumbers: [],
      discardPile: []
    };
  } else {
    state.secondChanceStats.appearedCount = Math.max(0, Math.floor(state.secondChanceStats.appearedCount));
    state.secondChanceStats.blockedNumbers = state.secondChanceStats.blockedNumbers.filter(
      (value) => typeof value === "number" && Number.isFinite(value)
    );
    state.secondChanceStats.discardPile = state.secondChanceStats.discardPile.filter(
      (entry) => typeof entry === "string"
    );
  }
  if (typeof state.updatedAt !== "number" || Number.isNaN(state.updatedAt)) {
    state.updatedAt = Date.now();
  }
  if (!state.winner) {
    state.winner = null;
  }
  if (!Array.isArray(state.pendingActionQueue)) {
    state.pendingActionQueue = [];
  }
  state.pendingActionQueue = state.pendingActionQueue.filter(
    (item) =>
      item &&
      (item.action === "freeze" || item.action === "flip_three") &&
      typeof item.chooserPlayerId === "string" &&
      typeof item.resumeFromPlayerId === "string" &&
      state.players.some((player) => player.id === item.chooserPlayerId)
  );
  if (
    !state.pendingFreeze ||
    typeof state.pendingFreeze.chooserPlayerId !== "string" ||
    typeof state.pendingFreeze.resumeFromPlayerId !== "string" ||
    !state.players.some((player) => player.id === state.pendingFreeze?.chooserPlayerId)
  ) {
    state.pendingFreeze = null;
  } else if (
    typeof state.pendingFreeze.expiresAt !== "number" ||
    !Number.isFinite(state.pendingFreeze.expiresAt)
  ) {
    state.pendingFreeze.expiresAt = Date.now() + FREEZE_TARGET_TIMEOUT_MS;
  }
  if (
    !state.pendingFlipThree ||
    typeof state.pendingFlipThree.sourcePlayerId !== "string" ||
    !state.players.some((player) => player.id === state.pendingFlipThree?.sourcePlayerId)
  ) {
    state.pendingFlipThree = null;
  } else if (typeof state.pendingFlipThree.resumeFromPlayerId !== "string") {
    state.pendingFlipThree.resumeFromPlayerId = state.pendingFlipThree.sourcePlayerId;
  }

  normalizeTurnOrder(state);
  const adminExists =
    typeof state.adminPlayerId === "string" &&
    state.players.some((player) => player.id === state.adminPlayerId);
  if (!adminExists) {
    state.adminPlayerId = state.players[0]?.id || null;
  }
  ensureCurrentTurn(state);
  return state;
}

function sanitizeName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, 20);
}

function clearPendingActionState(state: InternalGameState): void {
  state.pendingFreeze = null;
  state.pendingFlipThree = null;
  state.pendingActionQueue = [];
}

function shouldAutoResolveRound(state: InternalGameState): boolean {
  if (!state.gameStarted) return false;
  if (state.pendingFreeze || state.pendingFlipThree) return false;
  if (state.pendingActionQueue.length > 0) return false;
  return getActivePlayers(state).length === 0;
}

function resolveRoundAndMaybeStartNext(state: InternalGameState, reasonPrefix = ""): string {
  const nonBusted = state.players.filter((p) => !p.busted);
  let roundSummary = "";
  if (nonBusted.length > 0) {
    const topRoundScore = Math.max(...nonBusted.map((p) => p.roundScore));
    const winners = nonBusted.filter((p) => p.roundScore === topRoundScore);
    roundSummary =
      winners.length === 1
        ? `${winners[0].name} 以 ${topRoundScore} 分贏得第 ${state.round} 回合。`
        : `第 ${state.round} 回合平手，分數為 ${topRoundScore}。`;
  } else {
    roundSummary = `第 ${state.round} 回合結束：全員爆牌。`;
  }

  state.players.forEach((p) => {
    p.totalScore += p.roundScore;
  });

  const topTotal = Math.max(...state.players.map((p) => p.totalScore), 0);
  const leaders = state.players.filter((p) => p.totalScore === topTotal);

  if (topTotal >= WINNING_SCORE && leaders.length === 1) {
    const champion = leaders[0];
    state.winner = { playerId: champion.id, name: champion.name, totalScore: champion.totalScore };
    state.gameStarted = false;
    state.currentTurnPlayerId = null;
    state.turnStartedAt = null;
    clearPendingActionState(state);
    return `${reasonPrefix}${roundSummary} ${champion.name} 以 ${champion.totalScore} 分獲勝！`.trim();
  }

  const overtimeText =
    topTotal >= WINNING_SCORE && leaders.length > 1
      ? ` 目前 ${leaders.map((p) => p.name).join(" / ")} 同為 ${topTotal} 分，進入延長賽。`
      : "";

  state.players.forEach((player) => resetRoundFields(player));
  state.deck = createDeck();
  state.secondChanceStats = {
    appearedCount: 0,
    blockedNumbers: [],
    discardPile: []
  };
  state.round += 1;
  clearPendingActionState(state);
  normalizeTurnOrder(state);
  state.currentTurnPlayerId = getNextTurnPlayerId(state, null);
  if (state.currentTurnPlayerId) {
    state.turnStartedAt = Date.now();
  } else {
    state.turnStartedAt = null;
  }
  const next = getPlayerById(state, state.currentTurnPlayerId);
  const startText = next ? ` 已開始第 ${state.round} 回合，${next.name} 先手。` : ` 已開始第 ${state.round} 回合。`;
  return `${reasonPrefix}${roundSummary}${overtimeText}${startText}`.trim();
}

export function handleTurnTimeout(state: InternalGameState): string | null {
  if (!state.gameStarted || !state.currentTurnPlayerId || !state.turnStartedAt) return null;
  if (Date.now() < state.turnStartedAt + TURN_TIMEOUT_MS) return null;

  const player = getPlayerById(state, state.currentTurnPlayerId);
  if (!player || !isPlayable(player)) return null;

  // Auto-pass on timeout
  player.passed = true;
  player.passBonus = 0;
  recalculateRoundScore(player);
  const message = `${player.name} 操作逾時，已自動停牌。`;

  advanceTurn(state);

  if (shouldAutoResolveRound(state)) {
    return resolveRoundAndMaybeStartNext(state, `${message} `);
  }
  return message;
}

export function applyAction(state: InternalGameState, action: ClientAction, context: ApplyActionContext): void {
  normalizeTurnOrder(state);
  ensureCurrentTurn(state);
  const playerByClient = context.getRoomPlayerByClient(context.actor.room);
  context.actor.claimedPlayerId = playerByClient.get(context.actor.clientId) || null;
  const requesterPlayerId = playerByClient.get(context.actor.clientId) || null;
  const isRequesterAdmin = Boolean(requesterPlayerId && requesterPlayerId === state.adminPlayerId);

  const writeMessage = (msg: string) => {
    state.message = msg;
  };

  const timeoutMessage = resolveExpiredPendingFreeze(state);
  if (timeoutMessage) {
    writeMessage(`${timeoutMessage}（凍結指定逾時自動處理）`);
  }

  if (state.winner && action.action !== "resetGame" && action.action !== "startGame") {
    writeMessage(`${state.winner.name} 已經獲勝，請由房主開啟新局。`);
    state.updatedAt = Date.now();
    return;
  }

  switch (action.action) {
    case "addPlayer": {
      const name = sanitizeName(action.payload?.name);
      if (!name) {
        writeMessage("玩家名稱不可為空。");
        break;
      }
      if (state.players.length >= MAX_PLAYERS) {
        writeMessage(`最多只能 ${MAX_PLAYERS} 位玩家。`);
        break;
      }
      if (state.gameStarted) {
        writeMessage("遊戲進行中，請下一局再加入玩家。");
        break;
      }
      if (playerByClient.has(context.actor.clientId)) {
        writeMessage("同一個使用者只能新增一位玩家。");
        break;
      }
      const player = createPlayer(name);
      state.players.push(player);
      state.turnOrder.push(player.id);
      if (!state.adminPlayerId) {
        state.adminPlayerId = player.id;
      }
      playerByClient.set(context.actor.clientId, player.id);
      context.actor.claimedPlayerId = player.id;
      ensureCurrentTurn(state);
      if (state.adminPlayerId === player.id) {
        writeMessage(`${name} 加入了遊戲，並成為房主。`);
      } else {
        writeMessage(`${name} 加入了遊戲，並已自動綁定此裝置。`);
      }
      break;
    }

    case "renamePlayer": {
      const name = sanitizeName(action.payload?.name);
      const playerId = action.payload?.playerId;
      if (!name || typeof playerId !== "string") {
        writeMessage("改名請求格式錯誤。");
        break;
      }
      const ownedPlayerId = playerByClient.get(context.actor.clientId) || null;
      if (ownedPlayerId !== playerId) {
        writeMessage("你只能修改自己綁定的玩家名稱。");
        break;
      }
      const player = getPlayerById(state, playerId);
      if (!player) {
        writeMessage("找不到玩家。");
        break;
      }
      player.name = name;
      writeMessage(`玩家名稱已改為 ${name}。`);
      break;
    }

    case "startGame": {
      if (!requesterPlayerId) {
        writeMessage("請先新增你的玩家。");
        break;
      }
      if (!isRequesterAdmin) {
        writeMessage("只有房主可以開始新局。");
        break;
      }
      if (state.players.length === 0) {
        writeMessage("請先加入玩家。");
        break;
      }

      state.winner = null;
      state.gameStarted = true;
      state.round = 1;
      clearPendingActionState(state);
      state.deck = createDeck();
      state.secondChanceStats = {
        appearedCount: 0,
        blockedNumbers: [],
        discardPile: []
      };
      state.players.forEach((player) => {
        player.totalScore = 0;
        resetRoundFields(player);
      });
      normalizeTurnOrder(state);
      if (state.turnOrder.length > 1) {
        state.turnOrder = shuffle(state.turnOrder);
      }
      state.currentTurnPlayerId = getNextTurnPlayerId(state, null);
      if (state.currentTurnPlayerId) {
        state.turnStartedAt = Date.now();
      } else {
        state.turnStartedAt = null;
      }
      const first = getPlayerById(state, state.currentTurnPlayerId);
      writeMessage(first ? `新局開始，第 1 回合由 ${first.name} 先手。` : "新局開始，第 1 回合。");
      break;
    }

    case "dealSelf": {
      if (!state.gameStarted) {
        writeMessage("遊戲尚未開始，請由房主先開啟新局。");
        break;
      }
      if (state.pendingFreeze) {
        writeMessage("請先指定「凍結」的目標玩家。");
        break;
      }
      if (state.pendingFlipThree) {
        writeMessage("請先指定「翻三張」的目標玩家。");
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId) {
        writeMessage("請先新增你的玩家。");
        break;
      }
      if (state.currentTurnPlayerId !== claimedId) {
        writeMessage("現在不是你的回合。");
        break;
      }

      const player = getPlayerById(state, claimedId);
      if (!player || !isPlayable(player)) {
        writeMessage("目前無法抽牌。");
        break;
      }
      const card = drawFromDeck(state);
      const result = applyNormalCardToPlayer(state, player, card);
      if (result.endedByFlip7) {
        clearPendingActionState(state);
        writeMessage(resolveRoundAndMaybeStartNext(state, `${result.message} `));
        break;
      }
      writeMessage(result.message);
      if (!state.pendingFlipThree && !state.pendingFreeze) {
        advanceTurn(state);
      }
      break;
    }

    case "resolveFreezeTarget": {
      if (!state.gameStarted) {
        writeMessage("遊戲尚未開始，請由房主先開啟新局。");
        break;
      }
      const pending = state.pendingFreeze;
      if (!pending) {
        writeMessage("目前沒有待指定的凍結效果。");
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId || claimedId !== pending.chooserPlayerId) {
        writeMessage("只有凍結牌持有者可以指定目標。");
        break;
      }

      const targetPlayerId = action.payload?.targetPlayerId;
      if (typeof targetPlayerId !== "string" || !targetPlayerId.trim()) {
        writeMessage(resolvePendingFreezeEffect(state, null));
        break;
      }
      writeMessage(resolvePendingFreezeEffect(state, targetPlayerId));
      break;
    }

    case "selectFlipThreeTarget": {
      if (!state.gameStarted) {
        writeMessage("遊戲尚未開始，請由房主先開啟新局。");
        break;
      }
      if (state.pendingFreeze) {
        writeMessage("請先完成凍結目標指定。");
        break;
      }
      const pending = state.pendingFlipThree;
      if (!pending) {
        writeMessage("目前沒有待指定的翻三張效果。");
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId || claimedId !== pending.sourcePlayerId) {
        writeMessage("只有抽到「翻三張」的玩家可以指定目標。");
        break;
      }
      if (state.currentTurnPlayerId !== claimedId) {
        writeMessage("現在不是你處理翻三張的時機。");
        break;
      }

      const targetPlayerId = action.payload?.targetPlayerId;
      if (typeof targetPlayerId !== "string") {
        writeMessage("翻三張目標格式錯誤。");
        break;
      }
      const target = getPlayerById(state, targetPlayerId);
      if (!target) {
        writeMessage("找不到指定的目標玩家。");
        break;
      }
      if (!isPlayable(target)) {
        writeMessage("該玩家目前不可被指定（爆牌或已停牌）。");
        break;
      }

      const source = getPlayerById(state, pending.sourcePlayerId);
      const forced = resolveFlipThreeSequence(state, target, pending.resumeFromPlayerId);
      state.pendingFlipThree = null;

      if (!forced.endedByFlip7 && !forced.busted) {
        for (let i = forced.setAsideActions.length - 1; i >= 0; i -= 1) {
          enqueuePendingAction(state, forced.setAsideActions[i], true);
        }
      }

      if (forced.endedByFlip7) {
        clearPendingActionState(state);
        writeMessage(
          resolveRoundAndMaybeStartNext(
            state,
            `${source ? source.name : "玩家"} 指定 ${target.name} 連翻三張。${forced.messages.join(" ")} `
          )
        );
        break;
      }

      const dropped = promoteNextPendingAction(state);
      const pendingFreezeAfter = state.pendingFreeze as InternalGameState["pendingFreeze"];
      if (pendingFreezeAfter) {
        const freezeChooser = getPlayerById(state, pendingFreezeAfter.chooserPlayerId);
        writeMessage(
          `${source ? source.name : "玩家"} 指定 ${target.name} 連翻三張。${forced.messages.join(" ")} ${
            freezeChooser ? `請 ${freezeChooser.name} 指定凍結目標。` : ""
          } ${dropped.join(" ")}`.trim()
        );
        break;
      }
      const pendingFlipThreeAfter = state.pendingFlipThree as InternalGameState["pendingFlipThree"];
      if (pendingFlipThreeAfter) {
        const flipChooser = getPlayerById(state, pendingFlipThreeAfter.sourcePlayerId);
        writeMessage(
          `${source ? source.name : "玩家"} 指定 ${target.name} 連翻三張。${forced.messages.join(" ")} ${
            flipChooser ? `請 ${flipChooser.name} 指定翻三張目標。` : ""
          } ${dropped.join(" ")}`.trim()
        );
        break;
      }

      state.currentTurnPlayerId = pending.resumeFromPlayerId;
      advanceTurn(state);
      writeMessage(
        `${source ? source.name : "玩家"} 指定 ${target.name} 連翻三張。${forced.messages.join(" ")} ${dropped.join(
          " "
        )}`.trim()
      );
      break;
    }

    case "passSelf": {
      if (!state.gameStarted) {
        writeMessage("遊戲尚未開始，請由房主先開啟新局。");
        break;
      }
      if (state.pendingFreeze) {
        writeMessage("請先指定「凍結」的目標玩家。");
        break;
      }
      if (state.pendingFlipThree) {
        writeMessage("請先指定「翻三張」的目標玩家。");
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId) {
        writeMessage("請先新增你的玩家。");
        break;
      }
      if (state.currentTurnPlayerId !== claimedId) {
        writeMessage("現在不是你的回合。");
        break;
      }

      const player = getPlayerById(state, claimedId);
      if (!player || !isPlayable(player)) {
        writeMessage("目前無法停牌。");
        break;
      }
      player.passed = true;
      player.passBonus = 0;
      recalculateRoundScore(player);
      writeMessage(`${player.name} 停牌，本回合將被跳過。`);
      advanceTurn(state);
      break;
    }

    case "startNewRound": {
      if (!requesterPlayerId) {
        writeMessage("請先新增你的玩家。");
        break;
      }
      if (!isRequesterAdmin) {
        writeMessage("只有房主可以開始新回合。");
        break;
      }
      if (!state.gameStarted) {
        writeMessage("遊戲尚未開始，請先開啟新局。");
        break;
      }
      if (state.pendingFreeze) {
        writeMessage("請先完成凍結目標指定。");
        break;
      }
      if (state.pendingFlipThree) {
        writeMessage("請先完成翻三張指定目標。");
        break;
      }
      if (state.players.length === 0) {
        writeMessage("請先加入玩家。");
        break;
      }
      writeMessage(resolveRoundAndMaybeStartNext(state));
      break;
    }

    case "resetGame": {
      if (!requesterPlayerId) {
        writeMessage("請先新增你的玩家。");
        break;
      }
      if (!isRequesterAdmin) {
        writeMessage("只有房主可以重置遊戲。");
        break;
      }
      state.round = 0;
      state.gameStarted = false;
      state.adminPlayerId = null;
      clearPendingActionState(state);
      state.winner = null;
      state.players = [];
      state.turnOrder = [];
      state.currentTurnPlayerId = null;
      state.turnStartedAt = null;
      state.deck = createDeck();
      state.secondChanceStats = {
        appearedCount: 0,
        blockedNumbers: [],
        discardPile: []
      };
      context.clearRoomPlayerOwnership(context.actor.room);
      writeMessage("房間已重置為全新牌局。");
      break;
    }

    default:
      writeMessage("未知操作。");
      break;
  }

  if (shouldAutoResolveRound(state)) {
    writeMessage(resolveRoundAndMaybeStartNext(state, `${state.message} `));
  }

  ensureCurrentTurn(state);
  state.updatedAt = Date.now();
}
