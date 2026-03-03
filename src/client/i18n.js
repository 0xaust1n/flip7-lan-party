const DEFAULT_LOCALE = "zh-Hant";
const LOCALE_STORAGE_KEY = "flip7_locale";

const LOCALE_ALIASES = {
  zh: "zh-Hant",
  "zh-hant": "zh-Hant",
  "zh-tw": "zh-Hant",
  "zh-hk": "zh-Hant",
  en: "en",
  "en-us": "en",
  "en-gb": "en"
};

export const LOCALES = [
  { code: "zh-Hant", labelKey: "langZhHant" },
  { code: "en", labelKey: "langEn" }
];

const TEXT = {
  "zh-Hant": {
    appTitle: "Flip 7 Lan Party",
    languageLabel: "語言",
    langZhHant: "繁體中文",
    langEn: "English",

    connectionConnected: "已連線",
    connectionReconnecting: "重新連線中",
    connectionConnecting: "連線中",

    errorsServer: "伺服器錯誤。",
    errorsParseResponse: "無法解析伺服器回應。",
    errorsNotConnected: "尚未連線到伺服器。",

    joinPrompt: "先輸入房間名稱再加入遊戲。",
    roomPlaceholder: "例如：main 或 party-01",
    joinRoomButton: "加入房間",

    roomLabel: "房間",
    mySeatLabel: "我的座位",
    mySeatNotJoined: "尚未加入",
    roundPill: ({ round }) => `回合 ${round}`,
    gameInProgress: "遊戲進行中",
    gameWaiting: "等待中",

    gameTableTitle: "遊戲桌面",
    playersCount: ({ count, max }) => `${count} / ${max} 玩家`,
    nicknamePlaceholder: "輸入您的暱稱",
    joinBattle: "加入戰局",
    noPlayers: "目前沒有玩家加入",

    playerStateBusted: "爆牌",
    playerStatePassed: "已停牌",
    playerStateActive: "行動中",
    playerStateWaiting: "等待",

    roundScoreLabel: "本局得分",
    noCards: "無手牌",
    totalScoreLabel: "總分",
    secondChanceLabel: "第二次機會",

    actionDeal: "抽牌",
    actionPass: "停牌",
    selectFlipThreeTarget: "指定玩家連翻三張：",
    selectFreezeTarget: "指定玩家凍結：",

    leaderboardTitle: "排行榜",
    noScore: "目前沒有可顯示的分數。",
    meTag: "你",
    winnerTag: "WIN",
    roundScoreInline: ({ score }) => `本局 ${score}`,

    adminPanelTitle: "管理控制台",
    restartGame: "重新開始遊戲",
    startNewGame: "開始新局",
    manualStartRound: "手動開始新回合",
    resetRoom: "重置房間",
    adminOnlyTip: "只有房主可以控制遊戲流程",

    statsTitle: "統計數據",
    remainingDeck: "剩餘牌數",
    secondChanceCount: "第二次機會次數",
    blockedNumbers: "擋下的數字：",
    none: "無",
    recentActivity: "最近動態",
    noRecords: "尚無紀錄",

    rulesTitle: "遊戲規則說明 (v3.1)",
    ruleDeckDistTitle: "牌組分佈：",
    ruleDeckDistBody:
      "數字牌 (0-12) 採階梯式分佈，數字 1 有 1 張，數字 12 有 12 張（0 也是 1 張）。共 79 張數字牌。",
    ruleSpecialTitle: "特殊牌：",
    ruleSpecialBody:
      "凍結 (3)、翻三張 (3)、第二次機會 (3) 各 3 張。加分牌 (+2~+10) 與兩倍牌 (x2) 共 6 張。全組 94 張。",
    ruleTimeoutTitle: "回合時限：",
    ruleTimeoutBody: "每回合 30 秒，逾時將自動停牌。指定目標效果則有 15 秒時限。",
    ruleWinTitle: "獲勝條件：",
    ruleWinBody: "首位總分達到 200 分的玩家獲勝。若該回合多人達標且平手，將進入延長賽直到分出勝負。",

    winnerCongrats: "恭喜獲勝",
    winnerTotalScore: "總得分",
    openNewGame: "開啟新局"
  },
  en: {
    appTitle: "Flip 7 Lan Party",
    languageLabel: "Language",
    langZhHant: "Traditional Chinese",
    langEn: "English",

    connectionConnected: "Connected",
    connectionReconnecting: "Reconnecting",
    connectionConnecting: "Connecting",

    errorsServer: "Server error.",
    errorsParseResponse: "Unable to parse server response.",
    errorsNotConnected: "Not connected to the server yet.",

    joinPrompt: "Enter a room name before joining the game.",
    roomPlaceholder: "e.g. main or party-01",
    joinRoomButton: "Join Room",

    roomLabel: "Room",
    mySeatLabel: "My Seat",
    mySeatNotJoined: "Not joined",
    roundPill: ({ round }) => `Round ${round}`,
    gameInProgress: "In Game",
    gameWaiting: "Waiting",

    gameTableTitle: "Game Table",
    playersCount: ({ count, max }) => `${count} / ${max} players`,
    nicknamePlaceholder: "Enter your nickname",
    joinBattle: "Join Match",
    noPlayers: "No players have joined yet",

    playerStateBusted: "Busted",
    playerStatePassed: "Passed",
    playerStateActive: "Acting",
    playerStateWaiting: "Waiting",

    roundScoreLabel: "Round Score",
    noCards: "No cards",
    totalScoreLabel: "Total",
    secondChanceLabel: "Second Chance",

    actionDeal: "Draw",
    actionPass: "Pass",
    selectFlipThreeTarget: "Choose a player to flip three cards:",
    selectFreezeTarget: "Choose a player to freeze:",

    leaderboardTitle: "Leaderboard",
    noScore: "No scores to display yet.",
    meTag: "You",
    winnerTag: "WIN",
    roundScoreInline: ({ score }) => `Round ${score}`,

    adminPanelTitle: "Admin Panel",
    restartGame: "Restart Game",
    startNewGame: "Start New Game",
    manualStartRound: "Start Next Round Manually",
    resetRoom: "Reset Room",
    adminOnlyTip: "Only the room host can control game flow",

    statsTitle: "Stats",
    remainingDeck: "Cards Left",
    secondChanceCount: "Second Chance Count",
    blockedNumbers: "Blocked Numbers:",
    none: "None",
    recentActivity: "Recent Activity",
    noRecords: "No records yet",

    rulesTitle: "Rules (v3.1)",
    ruleDeckDistTitle: "Deck Distribution:",
    ruleDeckDistBody:
      "Number cards (0-12) use a stepped distribution: value 1 has 1 card, value 12 has 12 cards (value 0 also has 1 card). Total 79 number cards.",
    ruleSpecialTitle: "Special Cards:",
    ruleSpecialBody:
      "Freeze (3), Flip Three (3), and Second Chance (3) each appear 3 times. Modifier cards (+2 to +10) and x2 cards total 6 cards. 94 cards overall.",
    ruleTimeoutTitle: "Turn Time Limit:",
    ruleTimeoutBody: "Each turn is 30 seconds. Timeout auto-passes. Target-selection effects have a 15-second limit.",
    ruleWinTitle: "Win Condition:",
    ruleWinBody: "The first player to reach 200 total points wins. If multiple players tie after reaching the target in the same round, overtime continues until a winner is decided.",

    winnerCongrats: "Winner",
    winnerTotalScore: "Total Score",
    openNewGame: "Start New Game"
  }
};

const CARD_LABELS = {
  "zh-Hant": {
    凍結: "凍結",
    翻三張: "翻三張",
    第二次機會: "第二次機會"
  },
  en: {
    凍結: "Freeze",
    翻三張: "Flip Three",
    第二次機會: "Second Chance"
  }
};

export function resolveLocale(input) {
  if (!input) return DEFAULT_LOCALE;
  const normalized = String(input).trim().toLowerCase();
  if (!normalized) return DEFAULT_LOCALE;
  return LOCALE_ALIASES[normalized] || DEFAULT_LOCALE;
}

export function getInitialLocale() {
  const queryLocale = new URLSearchParams(window.location.search).get("lang");
  if (queryLocale) return resolveLocale(queryLocale);

  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved) return resolveLocale(saved);
  } catch {
    // Ignore localStorage access errors.
  }

  return resolveLocale(globalThis.navigator?.language || DEFAULT_LOCALE);
}

export function persistLocale(locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, resolveLocale(locale));
  } catch {
    // Ignore localStorage access errors.
  }
}

export function t(locale, key, params = {}) {
  const currentLocale = resolveLocale(locale);
  const localeTable = TEXT[currentLocale] || TEXT[DEFAULT_LOCALE];
  const fallbackTable = TEXT[DEFAULT_LOCALE];
  const raw = localeTable[key] ?? fallbackTable[key] ?? key;
  if (typeof raw === "function") return raw(params);
  return raw;
}

export function translateCardLabel(locale, label) {
  const currentLocale = resolveLocale(locale);
  return CARD_LABELS[currentLocale]?.[label] || label;
}
