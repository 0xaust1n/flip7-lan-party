import {
  InternalGameState,
  PublicGameState,
  ClientAction,
  ApplyActionContext,
  GameLocale,
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

const INTERNAL_CARD_LABELS = {
  freeze: "凍結",
  flipThree: "翻三張",
  secondChance: "第二次機會"
} as const;

type TextValue = string | ((params: Record<string, string | number>) => string);
type TextTable = Record<string, TextValue>;

const TEXT: Record<GameLocale, TextTable> = {
  "zh-Hant": {
    welcome: "歡迎來到 Flip 7，請先加入玩家並由房主開始新局。",
    playerFallback: "玩家",
    activeWord: "active",
    actionFreeze: "凍結",
    actionFlipThree: "翻三張",
    actionSecondChance: "第二次機會",
    actionCardDropped: ({ action, activeWord }) =>
      `已棄置動作牌：${action}（玩家已非 ${activeWord}）。`,
    secondChanceAppearedLog: ({ player }) => `${player} 抽到第二次機會`,
    secondChanceBlockedLog: ({ player, value }) => `${player} 第二次機會擋下 ${value}`,
    secondChanceGained: ({ player }) => `${player} 獲得「第二次機會」。`,
    secondChanceDuplicateDiscardLog: ({ player }) => `${player} 重複第二次機會無法轉交，棄牌`,
    secondChanceDuplicateDiscard: ({ player, activeWord }) =>
      `${player} 抽到「第二次機會」，但沒有可轉交的 ${activeWord} 玩家，故棄牌。`,
    secondChanceTransferredLog: ({ player, target }) => `${player} 的重複第二次機會轉交給 ${target}`,
    secondChanceTransferred: ({ player, target }) => `${player} 抽到重複「第二次機會」，轉交給 ${target}。`,
    noPendingFreeze: "目前沒有待指定的凍結效果。",
    freezeNoValidTarget: ({ chooser }) => `${chooser} 的凍結沒有有效目標，效果略過。`,
    freezeFallback: ({ chooser, target }) =>
      `${chooser} 的凍結目標失效，改為凍結 ${target}。${target} 本輪已 bank 並退出。`,
    freezeResolved: ({ chooser, target }) => `${chooser} 凍結了 ${target}。${target} 本輪已 bank 並退出。`,
    noCardToDraw: ({ player }) => `${player} 沒有可抽的牌。`,
    drewDuplicateBlocked: ({ player, value }) => `${player} 抽到重複數字 ${value}，但使用了「第二次機會」。`,
    drewDuplicateBusted: ({ player, value }) => `${player} 又抽到 ${value}，爆牌！`,
    drewNumberFlip7: ({ player, value }) => `${player} 抽到數字 ${value}，達成 Flip 7！本回合立即結束。`,
    drewNumber: ({ player, value }) => `${player} 抽到數字 ${value}。`,
    drewModifier: ({ player, card }) => `${player} 抽到修正牌 ${card}。`,
    drewFreezeNeedTarget: ({ player }) => `${player} 抽到「凍結」，請指定要凍結的玩家。`,
    drewFlipThreeNeedTarget: ({ player }) => `${player} 抽到「翻三張」，請指定一位玩家連翻三張。`,
    flipDuplicateBlocked: ({ player, value }) => `${player} 翻到重複數字 ${value}，使用了「第二次機會」。`,
    flipDuplicateBusted: ({ player, value }) => `${player} 翻到重複數字 ${value}，爆牌。`,
    flipHitFlip7: ({ player }) => `${player} 在翻三張過程達成 Flip 7！`,
    flipNumber: ({ player, value }) => `${player} 翻到數字 ${value}。`,
    flipModifier: ({ player, card }) => `${player} 翻到修正牌 ${card}。`,
    flipSetAside: ({ player, action }) => `${player} 翻到「${action}」，先 set aside。`,
    roundWinner: ({ player, score, round }) => `${player} 以 ${score} 分贏得第 ${round} 回合。`,
    roundTie: ({ round, score }) => `第 ${round} 回合平手，分數為 ${score}。`,
    roundAllBusted: ({ round }) => `第 ${round} 回合結束：全員爆牌。`,
    gameChampion: ({ player, score }) => `${player} 以 ${score} 分獲勝！`,
    overtime: ({ leaders, score }) => ` 目前 ${leaders} 同為 ${score} 分，進入延長賽。`,
    roundStartedWithFirst: ({ round, player }) => ` 已開始第 ${round} 回合，${player} 先手。`,
    roundStarted: ({ round }) => ` 已開始第 ${round} 回合。`,
    timeoutAutoPass: ({ player }) => `${player} 操作逾時，已自動停牌。`,
    timeoutFreezeAutoResolveSuffix: "（凍結指定逾時自動處理）",
    winnerAlreadyExists: ({ player }) => `${player} 已經獲勝，請由房主開啟新局。`,
    playerNameEmpty: "玩家名稱不可為空。",
    maxPlayers: ({ max }) => `最多只能 ${max} 位玩家。`,
    gameInProgressJoinLater: "遊戲進行中，請下一局再加入玩家。",
    onePlayerPerUser: "同一個使用者只能新增一位玩家。",
    joinedAsAdmin: ({ player }) => `${player} 加入了遊戲，並成為房主。`,
    joinedAndBound: ({ player }) => `${player} 加入了遊戲，並已自動綁定此裝置。`,
    renameBadRequest: "改名請求格式錯誤。",
    renameOnlyOwned: "你只能修改自己綁定的玩家名稱。",
    playerNotFound: "找不到玩家。",
    playerRenamed: ({ player }) => `玩家名稱已改為 ${player}。`,
    addPlayerFirst: "請先新增你的玩家。",
    onlyAdminStartGame: "只有房主可以開始新局。",
    joinPlayersFirst: "請先加入玩家。",
    newGameStartedWithFirst: ({ player }) => `新局開始，第 1 回合由 ${player} 先手。`,
    newGameStarted: "新局開始，第 1 回合。",
    gameNotStartedOpenGame: "遊戲尚未開始，請由房主先開啟新局。",
    specifyFreezeTargetFirst: "請先指定「凍結」的目標玩家。",
    specifyFlipThreeTargetFirst: "請先指定「翻三張」的目標玩家。",
    notYourTurn: "現在不是你的回合。",
    cannotDealNow: "目前無法抽牌。",
    onlyFreezeOwnerCanChoose: "只有凍結牌持有者可以指定目標。",
    completeFreezeFirst: "請先完成凍結目標指定。",
    noPendingFlipThree: "目前沒有待指定的翻三張效果。",
    onlyFlipThreeOwnerCanChoose: "只有抽到「翻三張」的玩家可以指定目標。",
    notYourTurnForFlipThree: "現在不是你處理翻三張的時機。",
    flipThreeTargetBadFormat: "翻三張目標格式錯誤。",
    targetPlayerNotFound: "找不到指定的目標玩家。",
    targetNotPlayable: "該玩家目前不可被指定（爆牌或已停牌）。",
    flipThreeAssignedPrefix: ({ source, target, details }) => `${source} 指定 ${target} 連翻三張。${details}`,
    askFreezeChooser: ({ player }) => `請 ${player} 指定凍結目標。`,
    askFlipChooser: ({ player }) => `請 ${player} 指定翻三張目標。`,
    cannotPassNow: "目前無法停牌。",
    passedThisRound: ({ player }) => `${player} 停牌，本回合將被跳過。`,
    onlyAdminStartRound: "只有房主可以開始新回合。",
    gameNotStartedYet: "遊戲尚未開始，請先開啟新局。",
    completeFlipThreeFirst: "請先完成翻三張指定目標。",
    onlyAdminReset: "只有房主可以重置遊戲。",
    roomReset: "房間已重置為全新牌局。",
    unknownAction: "未知操作。"
  },
  en: {
    welcome: "Welcome to Flip 7. Add players first, then let the host start a new game.",
    playerFallback: "Player",
    activeWord: "active",
    actionFreeze: "Freeze",
    actionFlipThree: "Flip Three",
    actionSecondChance: "Second Chance",
    actionCardDropped: ({ action, activeWord }) =>
      `Action card discarded: ${action} (owner is no longer ${activeWord}).`,
    secondChanceAppearedLog: ({ player }) => `${player} drew Second Chance`,
    secondChanceBlockedLog: ({ player, value }) => `${player} blocked ${value} with Second Chance`,
    secondChanceGained: ({ player }) => `${player} gained "Second Chance".`,
    secondChanceDuplicateDiscardLog: ({ player }) => `${player} drew duplicate Second Chance, cannot transfer, discarded`,
    secondChanceDuplicateDiscard: ({ player, activeWord }) =>
      `${player} drew "Second Chance", but there is no ${activeWord} player to transfer to, so it was discarded.`,
    secondChanceTransferredLog: ({ player, target }) => `${player}'s duplicate Second Chance was transferred to ${target}`,
    secondChanceTransferred: ({ player, target }) => `${player} drew duplicate "Second Chance" and transferred it to ${target}.`,
    noPendingFreeze: "There is no pending Freeze effect to resolve.",
    freezeNoValidTarget: ({ chooser }) => `${chooser}'s Freeze had no valid target and was skipped.`,
    freezeFallback: ({ chooser, target }) =>
      `${chooser}'s Freeze target became invalid, so ${target} was frozen instead. ${target} has banked and exited this round.`,
    freezeResolved: ({ chooser, target }) =>
      `${chooser} froze ${target}. ${target} has banked and exited this round.`,
    noCardToDraw: ({ player }) => `${player} has no card to draw.`,
    drewDuplicateBlocked: ({ player, value }) =>
      `${player} drew duplicate number ${value}, but used "Second Chance".`,
    drewDuplicateBusted: ({ player, value }) => `${player} drew ${value} again and busted!`,
    drewNumberFlip7: ({ player, value }) =>
      `${player} drew number ${value} and hit Flip 7! The round ends immediately.`,
    drewNumber: ({ player, value }) => `${player} drew number ${value}.`,
    drewModifier: ({ player, card }) => `${player} drew modifier card ${card}.`,
    drewFreezeNeedTarget: ({ player }) => `${player} drew "Freeze". Choose a player to freeze.`,
    drewFlipThreeNeedTarget: ({ player }) => `${player} drew "Flip Three". Choose a player to flip three cards.`,
    flipDuplicateBlocked: ({ player, value }) =>
      `${player} flipped duplicate number ${value} and used "Second Chance".`,
    flipDuplicateBusted: ({ player, value }) => `${player} flipped duplicate number ${value} and busted.`,
    flipHitFlip7: ({ player }) => `${player} hit Flip 7 during Flip Three!`,
    flipNumber: ({ player, value }) => `${player} flipped number ${value}.`,
    flipModifier: ({ player, card }) => `${player} flipped modifier card ${card}.`,
    flipSetAside: ({ player, action }) => `${player} flipped "${action}" and set it aside first.`,
    roundWinner: ({ player, score, round }) => `${player} won round ${round} with ${score} points.`,
    roundTie: ({ round, score }) => `Round ${round} is tied at ${score} points.`,
    roundAllBusted: ({ round }) => `Round ${round} ended: everyone busted.`,
    gameChampion: ({ player, score }) => `${player} wins with ${score} points!`,
    overtime: ({ leaders, score }) => ` ${leaders} are tied at ${score}, entering overtime.`,
    roundStartedWithFirst: ({ round, player }) => ` Round ${round} started. ${player} goes first.`,
    roundStarted: ({ round }) => ` Round ${round} started.`,
    timeoutAutoPass: ({ player }) => `${player} timed out and was auto-passed.`,
    timeoutFreezeAutoResolveSuffix: "(Freeze target timed out and was auto-resolved)",
    winnerAlreadyExists: ({ player }) => `${player} has already won. Ask the host to start a new game.`,
    playerNameEmpty: "Player name cannot be empty.",
    maxPlayers: ({ max }) => `At most ${max} players are allowed.`,
    gameInProgressJoinLater: "Game is in progress. Join in the next game.",
    onePlayerPerUser: "Each user can only add one player.",
    joinedAsAdmin: ({ player }) => `${player} joined and became the host.`,
    joinedAndBound: ({ player }) => `${player} joined and was auto-bound to this device.`,
    renameBadRequest: "Invalid rename request format.",
    renameOnlyOwned: "You can only rename the player bound to you.",
    playerNotFound: "Player not found.",
    playerRenamed: ({ player }) => `Player name changed to ${player}.`,
    addPlayerFirst: "Please add your player first.",
    onlyAdminStartGame: "Only the host can start a new game.",
    joinPlayersFirst: "Please add players first.",
    newGameStartedWithFirst: ({ player }) => `New game started. Round 1 begins with ${player}.`,
    newGameStarted: "New game started. Round 1 begins.",
    gameNotStartedOpenGame: "Game has not started. Ask the host to start a new game first.",
    specifyFreezeTargetFirst: 'Please choose a target for "Freeze" first.',
    specifyFlipThreeTargetFirst: 'Please choose a target for "Flip Three" first.',
    notYourTurn: "It is not your turn.",
    cannotDealNow: "Cannot draw a card right now.",
    onlyFreezeOwnerCanChoose: 'Only the player who drew "Freeze" can choose the target.',
    completeFreezeFirst: "Please complete Freeze target selection first.",
    noPendingFlipThree: "There is no pending Flip Three effect to resolve.",
    onlyFlipThreeOwnerCanChoose: 'Only the player who drew "Flip Three" can choose the target.',
    notYourTurnForFlipThree: "It is not your timing to resolve Flip Three.",
    flipThreeTargetBadFormat: "Invalid Flip Three target format.",
    targetPlayerNotFound: "Target player not found.",
    targetNotPlayable: "That player cannot be targeted right now (busted or passed).",
    flipThreeAssignedPrefix: ({ source, target, details }) => `${source} assigned Flip Three to ${target}. ${details}`,
    askFreezeChooser: ({ player }) => `Ask ${player} to choose a Freeze target.`,
    askFlipChooser: ({ player }) => `Ask ${player} to choose a Flip Three target.`,
    cannotPassNow: "Cannot pass right now.",
    passedThisRound: ({ player }) => `${player} passed and will be skipped this round.`,
    onlyAdminStartRound: "Only the host can start a new round.",
    gameNotStartedYet: "Game has not started. Start a new game first.",
    completeFlipThreeFirst: "Please complete Flip Three target selection first.",
    onlyAdminReset: "Only the host can reset the game.",
    roomReset: "Room has been reset to a fresh game.",
    unknownAction: "Unknown action."
  }
};

export function resolveGameLocale(input: string | null | undefined): GameLocale {
  return String(input || "").toLowerCase().startsWith("en") ? "en" : "zh-Hant";
}

function getLocale(state: InternalGameState): GameLocale {
  return resolveGameLocale(state.locale);
}

function t(state: InternalGameState, key: string, params: Record<string, string | number> = {}): string {
  const locale = getLocale(state);
  const value = TEXT[locale][key] ?? TEXT["zh-Hant"][key] ?? key;
  if (typeof value === "function") return value(params);
  return value;
}

function tByLocale(locale: GameLocale, key: string, params: Record<string, string | number> = {}): string {
  const value = TEXT[locale][key] ?? TEXT["zh-Hant"][key] ?? key;
  if (typeof value === "function") return value(params);
  return value;
}

function localizedActionName(state: InternalGameState, action: PendingQueuedAction["action"]): string {
  return action === "freeze" ? t(state, "actionFreeze") : t(state, "actionFlipThree");
}

function displayCardLabel(state: InternalGameState, card: Card): string {
  if (card.kind === "number") return String(card.value);
  if (card.kind === "modifier") return card.modifier === "x2" ? "x2" : `+${card.value}`;
  if (card.action === "freeze") return t(state, "actionFreeze");
  if (card.action === "flip_three") return t(state, "actionFlipThree");
  return t(state, "actionSecondChance");
}

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
    locale: "zh-Hant",
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
    message: tByLocale("zh-Hant", "welcome"),
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
      droppedMessages.push(
        t(state, "actionCardDropped", {
          action: localizedActionName(state, next.action),
          activeWord: t(state, "activeWord")
        })
      );
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
  appendSecondChanceDiscardEntry(state, t(state, "secondChanceAppearedLog", { player: playerName }));
}

function markSecondChanceBlockedNumber(state: InternalGameState, playerName: string, value: number): void {
  state.secondChanceStats.blockedNumbers.push(value);
  if (state.secondChanceStats.blockedNumbers.length > 80) {
    state.secondChanceStats.blockedNumbers.splice(0, state.secondChanceStats.blockedNumbers.length - 80);
  }
  appendSecondChanceDiscardEntry(
    state,
    t(state, "secondChanceBlockedLog", { player: playerName, value })
  );
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
    player.cards.push(INTERNAL_CARD_LABELS.secondChance);
    return t(state, "secondChanceGained", { player: player.name });
  }

  const transferTarget = pickSecondChanceTransferTarget(state, player.id);
  if (!transferTarget) {
    appendSecondChanceDiscardEntry(
      state,
      t(state, "secondChanceDuplicateDiscardLog", { player: player.name })
    );
    return t(state, "secondChanceDuplicateDiscard", {
      player: player.name,
      activeWord: t(state, "activeWord")
    });
  }

  transferTarget.secondChance = true;
  transferTarget.cards.push(INTERNAL_CARD_LABELS.secondChance);
  appendSecondChanceDiscardEntry(
    state,
    t(state, "secondChanceTransferredLog", { player: player.name, target: transferTarget.name })
  );
  return t(state, "secondChanceTransferred", { player: player.name, target: transferTarget.name });
}

function resolvePendingFreezeEffect(state: InternalGameState, requestedTargetId: string | null): string {
  const pending = state.pendingFreeze;
  if (!pending) return t(state, "noPendingFreeze");

  const chooser = getPlayerById(state, pending.chooserPlayerId);
  let target = requestedTargetId ? getPlayerById(state, requestedTargetId) : null;
  let usedFallback = false;
  if (!target || !isPlayable(target)) {
    usedFallback = true;
    target = pickFreezeFallbackTarget(state, pending.chooserPlayerId);
  }

  let message = "";
  if (!target) {
    message = t(state, "freezeNoValidTarget", {
      chooser: chooser?.name || t(state, "playerFallback")
    });
  } else {
    target.passed = true;
    target.passBonus = 0;
    recalculateRoundScore(target);
    message = usedFallback
      ? t(state, "freezeFallback", {
          chooser: chooser?.name || t(state, "playerFallback"),
          target: target.name
        })
      : t(state, "freezeResolved", {
          chooser: chooser?.name || t(state, "playerFallback"),
          target: target.name
        });
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
  if (card.action === "freeze") return INTERNAL_CARD_LABELS.freeze;
  if (card.action === "flip_three") return INTERNAL_CARD_LABELS.flipThree;
  return INTERNAL_CARD_LABELS.secondChance;
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
    return { message: t(state, "noCardToDraw", { player: player.name }), endedByFlip7: false };
  }

  if (card.kind === "number") {
    if (player.numberCards.includes(card.value)) {
      if (player.secondChance) {
        player.secondChance = false;
        removeOneCardLabel(player, INTERNAL_CARD_LABELS.secondChance);
        markSecondChanceBlockedNumber(state, player.name, card.value);
        recalculateRoundScore(player);
        return {
          message: t(state, "drewDuplicateBlocked", { player: player.name, value: card.value }),
          endedByFlip7: false
        };
      }
      player.cards.push(cardLabel(card));
      player.busted = true;
      player.roundScore = 0;
      player.passBonus = 0;
      return { message: t(state, "drewDuplicateBusted", { player: player.name, value: card.value }), endedByFlip7: false };
    }

    player.numberCards.push(card.value);
    player.cards.push(cardLabel(card));
    recalculateRoundScore(player);
    if (hasFlip7(player)) {
      return { message: t(state, "drewNumberFlip7", { player: player.name, value: card.value }), endedByFlip7: true };
    }
    return { message: t(state, "drewNumber", { player: player.name, value: card.value }), endedByFlip7: false };
  }

  if (card.kind === "modifier") {
    if (card.modifier === "x2") {
      player.hasX2 = true;
    } else {
      player.modifierBonus += card.value || 0;
    }
    player.cards.push(cardLabel(card));
    recalculateRoundScore(player);
    return {
      message: t(state, "drewModifier", { player: player.name, card: displayCardLabel(state, card) }),
      endedByFlip7: false
    };
  }

  if (card.action === "second_chance") {
    const message = handleSecondChanceDraw(state, player);
    return { message, endedByFlip7: false };
  }

  if (card.action === "freeze") {
    player.cards.push(INTERNAL_CARD_LABELS.freeze);
    state.pendingFreeze = {
      chooserPlayerId: player.id,
      resumeFromPlayerId: player.id,
      expiresAt: Date.now() + FREEZE_TARGET_TIMEOUT_MS
    };
    return { message: t(state, "drewFreezeNeedTarget", { player: player.name }), endedByFlip7: false };
  }

  player.cards.push(INTERNAL_CARD_LABELS.flipThree);
  state.pendingFlipThree = { sourcePlayerId: player.id, resumeFromPlayerId: player.id };
  return { message: t(state, "drewFlipThreeNeedTarget", { player: player.name }), endedByFlip7: false };
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
      messages.push(t(state, "noCardToDraw", { player: target.name }));
      break;
    }

    if (card.kind === "number") {
      if (target.numberCards.includes(card.value)) {
        if (target.secondChance) {
          target.secondChance = false;
          removeOneCardLabel(target, INTERNAL_CARD_LABELS.secondChance);
          markSecondChanceBlockedNumber(state, target.name, card.value);
          recalculateRoundScore(target);
          messages.push(t(state, "flipDuplicateBlocked", { player: target.name, value: card.value }));
          continue;
        }
        target.cards.push(cardLabel(card));
        target.busted = true;
        target.roundScore = 0;
        target.passBonus = 0;
        messages.push(t(state, "flipDuplicateBusted", { player: target.name, value: card.value }));
        break;
      }

      target.numberCards.push(card.value);
      target.cards.push(cardLabel(card));
      recalculateRoundScore(target);
      if (hasFlip7(target)) {
        endedByFlip7 = true;
        messages.push(t(state, "flipHitFlip7", { player: target.name }));
        break;
      }
      messages.push(t(state, "flipNumber", { player: target.name, value: card.value }));
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
      messages.push(t(state, "flipModifier", { player: target.name, card: displayCardLabel(state, card) }));
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
    messages.push(t(state, "flipSetAside", { player: target.name, action: displayCardLabel(state, card) }));
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
    locale: getLocale(state),
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
  state.locale = resolveGameLocale(state.locale);
  if (!Array.isArray(state.players)) state.players = [];
  if (!Array.isArray(state.turnOrder)) state.turnOrder = [];
  if (typeof state.gameStarted !== "boolean") state.gameStarted = false;
  if (typeof state.round !== "number" || Number.isNaN(state.round)) {
    state.round = state.gameStarted ? 1 : 0;
  }
  if (typeof state.message !== "string") {
    state.message = t(state, "welcome");
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
        ? t(state, "roundWinner", { player: winners[0].name, score: topRoundScore, round: state.round })
        : t(state, "roundTie", { round: state.round, score: topRoundScore });
  } else {
    roundSummary = t(state, "roundAllBusted", { round: state.round });
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
    return `${reasonPrefix}${roundSummary} ${t(state, "gameChampion", {
      player: champion.name,
      score: champion.totalScore
    })}`.trim();
  }

  const overtimeText =
    topTotal >= WINNING_SCORE && leaders.length > 1
      ? t(state, "overtime", { leaders: leaders.map((p) => p.name).join(" / "), score: topTotal })
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
  const startText = next
    ? t(state, "roundStartedWithFirst", { round: state.round, player: next.name })
    : t(state, "roundStarted", { round: state.round });
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
  const message = t(state, "timeoutAutoPass", { player: player.name });

  advanceTurn(state);

  if (shouldAutoResolveRound(state)) {
    return resolveRoundAndMaybeStartNext(state, `${message} `);
  }
  return message;
}

export function applyAction(state: InternalGameState, action: ClientAction, context: ApplyActionContext): void {
  state.locale = resolveGameLocale(context.actor.locale || state.locale);
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
    writeMessage(`${timeoutMessage}${t(state, "timeoutFreezeAutoResolveSuffix")}`);
  }

  if (state.winner && action.action !== "resetGame" && action.action !== "startGame") {
    writeMessage(t(state, "winnerAlreadyExists", { player: state.winner.name }));
    state.updatedAt = Date.now();
    return;
  }

  switch (action.action) {
    case "addPlayer": {
      const name = sanitizeName(action.payload?.name);
      if (!name) {
        writeMessage(t(state, "playerNameEmpty"));
        break;
      }
      if (state.players.length >= MAX_PLAYERS) {
        writeMessage(t(state, "maxPlayers", { max: MAX_PLAYERS }));
        break;
      }
      if (state.gameStarted) {
        writeMessage(t(state, "gameInProgressJoinLater"));
        break;
      }
      if (playerByClient.has(context.actor.clientId)) {
        writeMessage(t(state, "onePlayerPerUser"));
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
        writeMessage(t(state, "joinedAsAdmin", { player: name }));
      } else {
        writeMessage(t(state, "joinedAndBound", { player: name }));
      }
      break;
    }

    case "renamePlayer": {
      const name = sanitizeName(action.payload?.name);
      const playerId = action.payload?.playerId;
      if (!name || typeof playerId !== "string") {
        writeMessage(t(state, "renameBadRequest"));
        break;
      }
      const ownedPlayerId = playerByClient.get(context.actor.clientId) || null;
      if (ownedPlayerId !== playerId) {
        writeMessage(t(state, "renameOnlyOwned"));
        break;
      }
      const player = getPlayerById(state, playerId);
      if (!player) {
        writeMessage(t(state, "playerNotFound"));
        break;
      }
      player.name = name;
      writeMessage(t(state, "playerRenamed", { player: name }));
      break;
    }

    case "startGame": {
      if (!requesterPlayerId) {
        writeMessage(t(state, "addPlayerFirst"));
        break;
      }
      if (!isRequesterAdmin) {
        writeMessage(t(state, "onlyAdminStartGame"));
        break;
      }
      if (state.players.length === 0) {
        writeMessage(t(state, "joinPlayersFirst"));
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
      writeMessage(
        first
          ? t(state, "newGameStartedWithFirst", { player: first.name })
          : t(state, "newGameStarted")
      );
      break;
    }

    case "dealSelf": {
      if (!state.gameStarted) {
        writeMessage(t(state, "gameNotStartedOpenGame"));
        break;
      }
      if (state.pendingFreeze) {
        writeMessage(t(state, "specifyFreezeTargetFirst"));
        break;
      }
      if (state.pendingFlipThree) {
        writeMessage(t(state, "specifyFlipThreeTargetFirst"));
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId) {
        writeMessage(t(state, "addPlayerFirst"));
        break;
      }
      if (state.currentTurnPlayerId !== claimedId) {
        writeMessage(t(state, "notYourTurn"));
        break;
      }

      const player = getPlayerById(state, claimedId);
      if (!player || !isPlayable(player)) {
        writeMessage(t(state, "cannotDealNow"));
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
        writeMessage(t(state, "gameNotStartedOpenGame"));
        break;
      }
      const pending = state.pendingFreeze;
      if (!pending) {
        writeMessage(t(state, "noPendingFreeze"));
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId || claimedId !== pending.chooserPlayerId) {
        writeMessage(t(state, "onlyFreezeOwnerCanChoose"));
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
        writeMessage(t(state, "gameNotStartedOpenGame"));
        break;
      }
      if (state.pendingFreeze) {
        writeMessage(t(state, "completeFreezeFirst"));
        break;
      }
      const pending = state.pendingFlipThree;
      if (!pending) {
        writeMessage(t(state, "noPendingFlipThree"));
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId || claimedId !== pending.sourcePlayerId) {
        writeMessage(t(state, "onlyFlipThreeOwnerCanChoose"));
        break;
      }
      if (state.currentTurnPlayerId !== claimedId) {
        writeMessage(t(state, "notYourTurnForFlipThree"));
        break;
      }

      const targetPlayerId = action.payload?.targetPlayerId;
      if (typeof targetPlayerId !== "string") {
        writeMessage(t(state, "flipThreeTargetBadFormat"));
        break;
      }
      const target = getPlayerById(state, targetPlayerId);
      if (!target) {
        writeMessage(t(state, "targetPlayerNotFound"));
        break;
      }
      if (!isPlayable(target)) {
        writeMessage(t(state, "targetNotPlayable"));
        break;
      }

      const source = getPlayerById(state, pending.sourcePlayerId);
      const sourceName = source ? source.name : t(state, "playerFallback");
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
            `${t(state, "flipThreeAssignedPrefix", {
              source: sourceName,
              target: target.name,
              details: forced.messages.join(" ")
            })} `
          )
        );
        break;
      }

      const dropped = promoteNextPendingAction(state);
      const pendingFreezeAfter = state.pendingFreeze as InternalGameState["pendingFreeze"];
      if (pendingFreezeAfter) {
        const freezeChooser = getPlayerById(state, pendingFreezeAfter.chooserPlayerId);
        const extra = freezeChooser ? t(state, "askFreezeChooser", { player: freezeChooser.name }) : "";
        writeMessage(
          `${t(state, "flipThreeAssignedPrefix", {
            source: sourceName,
            target: target.name,
            details: forced.messages.join(" ")
          })} ${extra} ${dropped.join(" ")}`.trim()
        );
        break;
      }
      const pendingFlipThreeAfter = state.pendingFlipThree as InternalGameState["pendingFlipThree"];
      if (pendingFlipThreeAfter) {
        const flipChooser = getPlayerById(state, pendingFlipThreeAfter.sourcePlayerId);
        const extra = flipChooser ? t(state, "askFlipChooser", { player: flipChooser.name }) : "";
        writeMessage(
          `${t(state, "flipThreeAssignedPrefix", {
            source: sourceName,
            target: target.name,
            details: forced.messages.join(" ")
          })} ${extra} ${dropped.join(" ")}`.trim()
        );
        break;
      }

      state.currentTurnPlayerId = pending.resumeFromPlayerId;
      advanceTurn(state);
      writeMessage(
        `${t(state, "flipThreeAssignedPrefix", {
          source: sourceName,
          target: target.name,
          details: forced.messages.join(" ")
        })} ${dropped.join(" ")}`.trim()
      );
      break;
    }

    case "passSelf": {
      if (!state.gameStarted) {
        writeMessage(t(state, "gameNotStartedOpenGame"));
        break;
      }
      if (state.pendingFreeze) {
        writeMessage(t(state, "specifyFreezeTargetFirst"));
        break;
      }
      if (state.pendingFlipThree) {
        writeMessage(t(state, "specifyFlipThreeTargetFirst"));
        break;
      }
      const claimedId = playerByClient.get(context.actor.clientId) || null;
      if (!claimedId) {
        writeMessage(t(state, "addPlayerFirst"));
        break;
      }
      if (state.currentTurnPlayerId !== claimedId) {
        writeMessage(t(state, "notYourTurn"));
        break;
      }

      const player = getPlayerById(state, claimedId);
      if (!player || !isPlayable(player)) {
        writeMessage(t(state, "cannotPassNow"));
        break;
      }
      player.passed = true;
      player.passBonus = 0;
      recalculateRoundScore(player);
      writeMessage(t(state, "passedThisRound", { player: player.name }));
      advanceTurn(state);
      break;
    }

    case "startNewRound": {
      if (!requesterPlayerId) {
        writeMessage(t(state, "addPlayerFirst"));
        break;
      }
      if (!isRequesterAdmin) {
        writeMessage(t(state, "onlyAdminStartRound"));
        break;
      }
      if (!state.gameStarted) {
        writeMessage(t(state, "gameNotStartedYet"));
        break;
      }
      if (state.pendingFreeze) {
        writeMessage(t(state, "completeFreezeFirst"));
        break;
      }
      if (state.pendingFlipThree) {
        writeMessage(t(state, "completeFlipThreeFirst"));
        break;
      }
      if (state.players.length === 0) {
        writeMessage(t(state, "joinPlayersFirst"));
        break;
      }
      writeMessage(resolveRoundAndMaybeStartNext(state));
      break;
    }

    case "resetGame": {
      if (!requesterPlayerId) {
        writeMessage(t(state, "addPlayerFirst"));
        break;
      }
      if (!isRequesterAdmin) {
        writeMessage(t(state, "onlyAdminReset"));
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
      writeMessage(t(state, "roomReset"));
      break;
    }

    default:
      writeMessage(t(state, "unknownAction"));
      break;
  }

  if (shouldAutoResolveRound(state)) {
    writeMessage(resolveRoundAndMaybeStartNext(state, `${state.message} `));
  }

  ensureCurrentTurn(state);
  state.updatedAt = Date.now();
}
