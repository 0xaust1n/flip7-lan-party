import { describe, expect, test } from "bun:test";
import { applyAction, createInitialState } from "./server";

type WSStub = {
  data: {
    room: string;
    clientId: string;
    claimedPlayerId: string | null;
  };
  send: (payload: string) => void;
};

function makeWs(room: string, clientId: string): WSStub {
  return {
    data: { room, clientId, claimedPlayerId: null },
    send() {
      // no-op for tests
    }
  };
}

function act(state: ReturnType<typeof createInitialState>, ws: WSStub, action: string, payload?: unknown): void {
  applyAction(
    state,
    payload === undefined
      ? ({ type: "action", action } as never)
      : ({ type: "action", action, payload } as never),
    ws as never
  );
}

function setupPlayers(count: number, room = `r-${crypto.randomUUID()}`) {
  const state = createInitialState(room);
  const sockets = Array.from({ length: count }, (_, i) => makeWs(room, `user-${i}-${room}`));

  sockets.forEach((ws, i) => {
    act(state, ws, "addPlayer", { name: String.fromCharCode(65 + i) });
  });
  act(state, sockets[0], "startGame");

  const players = sockets.map((_, i) => state.players.find((p) => p.name === String.fromCharCode(65 + i)));
  if (players.some((p) => !p)) throw new Error("test setup failed to resolve players");

  state.turnOrder = players.map((p) => p!.id);
  state.currentTurnPlayerId = players[0]!.id;
  return { state, sockets, players: players as NonNullable<(typeof players)[number]>[] };
}

describe("Flip 7 ruleset 3.1 alignment", () => {
  test("Freeze can target another active player", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a, b] = players;
    const [wsA] = sockets;
    state.deck = [{ kind: "action", action: "freeze" }];

    act(state, wsA, "dealSelf");
    expect(state.pendingFreeze?.chooserPlayerId).toBe(a.id);
    act(state, wsA, "resolveFreezeTarget", { targetPlayerId: b.id });

    expect(b.passed).toBe(true);
    expect(b.passBonus).toBe(0);
    expect(state.pendingFreeze).toBeNull();
  });

  test("Freeze can target self", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a, b] = players;
    const [wsA] = sockets;
    state.deck = [{ kind: "action", action: "freeze" }];

    act(state, wsA, "dealSelf");
    act(state, wsA, "resolveFreezeTarget", { targetPlayerId: a.id });

    expect(a.passed).toBe(true);
    expect(a.passBonus).toBe(0);
    expect(b.passed).toBe(false);
    expect(state.currentTurnPlayerId).toBe(b.id);
  });

  test("Flip Three defers Freeze until three flips finish", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a, b] = players;
    const [wsA, wsB] = sockets;
    state.deck = [
      { kind: "number", value: 4 },
      { kind: "number", value: 3 },
      { kind: "action", action: "freeze" },
      { kind: "action", action: "flip_three" }
    ];

    act(state, wsA, "dealSelf");
    act(state, wsA, "selectFlipThreeTarget", { targetPlayerId: b.id });

    expect(state.pendingFlipThree).toBeNull();
    expect(state.pendingFreeze?.chooserPlayerId).toBe(b.id);
    expect(b.passed).toBe(false);
    expect(b.numberCards).toEqual([3, 4]);

    act(state, wsB, "resolveFreezeTarget", { targetPlayerId: a.id });
    expect(a.passed).toBe(true);
  });

  test("Flip Three chained Flip Three is queued and resolved in order", () => {
    const { state, sockets, players } = setupPlayers(3);
    const [a, b, c] = players;
    const [wsA, wsB] = sockets;
    state.deck = [
      { kind: "number", value: 3 },
      { kind: "number", value: 2 },
      { kind: "number", value: 1 },
      { kind: "number", value: 5 },
      { kind: "action", action: "flip_three" },
      { kind: "action", action: "freeze" },
      { kind: "action", action: "flip_three" }
    ];

    act(state, wsA, "dealSelf");
    act(state, wsA, "selectFlipThreeTarget", { targetPlayerId: b.id });

    expect(state.pendingFreeze?.chooserPlayerId).toBe(b.id);
    expect(state.pendingFlipThree).toBeNull();
    // Must resolve freeze first.
    act(state, wsB, "selectFlipThreeTarget", { targetPlayerId: c.id });
    expect(state.pendingFlipThree).toBeNull();
    expect(state.message.includes("請先完成凍結目標指定")).toBe(true);

    act(state, wsB, "resolveFreezeTarget", { targetPlayerId: a.id });
    expect(a.passed).toBe(true);
    expect(state.pendingFlipThree?.sourcePlayerId).toBe(b.id);

    act(state, wsB, "selectFlipThreeTarget", { targetPlayerId: c.id });
    expect(state.pendingFreeze).toBeNull();
    expect(state.pendingFlipThree).toBeNull();
    expect(state.pendingActionQueue.length).toBe(0);
    // Resume from A, then advance to next active (A is passed).
    expect(state.currentTurnPlayerId).toBe(b.id);
  });

  test("Set-aside actions are discarded when Flip Three target busts", () => {
    const { state, sockets, players } = setupPlayers(3);
    const [, b, c] = players;
    const [wsA] = sockets;
    state.deck = [
      { kind: "number", value: 2 },
      { kind: "number", value: 2 },
      { kind: "action", action: "freeze" },
      { kind: "action", action: "flip_three" }
    ];

    act(state, wsA, "dealSelf");
    act(state, wsA, "selectFlipThreeTarget", { targetPlayerId: b.id });

    expect(b.busted).toBe(true);
    expect(b.cards).toEqual(["2", "2"]);
    expect(state.pendingFreeze).toBeNull();
    expect(state.pendingFlipThree).toBeNull();
    expect(state.pendingActionQueue.length).toBe(0);
    expect(state.currentTurnPlayerId).toBe(c.id);
  });

  test("Normal bust keeps the busting number visible in hand", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a] = players;
    const [wsA] = sockets;
    a.numberCards = [4];
    a.cards = ["4"];
    a.roundScore = 4;
    state.currentTurnPlayerId = a.id;
    state.deck = [{ kind: "number", value: 4 }];

    act(state, wsA, "dealSelf");

    expect(a.busted).toBe(true);
    expect(a.cards).toEqual(["4", "4"]);
  });

  test("Set-aside actions are discarded when Flip Three target hits Flip7", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a, b] = players;
    const [wsA] = sockets;
    b.numberCards = [0, 1, 2, 3, 4, 5];
    b.cards = ["0", "1", "2", "3", "4", "5"];

    state.deck = [
      { kind: "number", value: 6 },
      { kind: "action", action: "freeze" },
      { kind: "action", action: "flip_three" }
    ];

    act(state, wsA, "dealSelf");
    act(state, wsA, "selectFlipThreeTarget", { targetPlayerId: b.id });

    expect(state.pendingFreeze).toBeNull();
    expect(state.pendingFlipThree).toBeNull();
    expect(state.pendingActionQueue.length).toBe(0);
    // Round auto-ends and starts next round.
    expect(state.round).toBe(2);
    expect(state.message.includes("Flip 7")).toBe(true);
  });

  test("Duplicate Second Chance transfers to another active player, else discards", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a, b] = players;
    const [wsA] = sockets;

    a.secondChance = true;
    a.cards.push("第二次機會");
    state.deck = [{ kind: "action", action: "second_chance" }];
    act(state, wsA, "dealSelf");
    expect(a.secondChance).toBe(true);
    expect(b.secondChance).toBe(true);

    // reset and test discard path (no other active player)
    b.secondChance = false;
    b.passed = true;
    state.currentTurnPlayerId = a.id;
    state.deck = [{ kind: "action", action: "second_chance" }];
    act(state, wsA, "dealSelf");
    expect(state.message.includes("棄牌")).toBe(true);
  });

  test("Round auto-starts next round when all players are passed or busted", () => {
    const { state, sockets } = setupPlayers(2);
    const [wsA, wsB] = sockets;

    act(state, wsA, "passSelf");
    act(state, wsB, "passSelf");

    expect(state.round).toBe(2);
    expect(state.gameStarted).toBe(true);
    expect(state.players.every((player) => !player.passed && !player.busted)).toBe(true);
    expect(state.message.includes("已開始第 2 回合")).toBe(true);
  });

  test("Second Chance stats track appearances and blocked numbers", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a] = players;
    const [wsA] = sockets;

    state.deck = [{ kind: "action", action: "second_chance" }];
    act(state, wsA, "dealSelf");
    expect(state.secondChanceStats.appearedCount).toBe(1);
    expect(a.secondChance).toBe(true);

    a.numberCards = [7];
    a.cards = ["7", "第二次機會"];
    a.roundScore = 7;
    state.currentTurnPlayerId = a.id;
    state.deck = [{ kind: "number", value: 7 }];
    act(state, wsA, "dealSelf");

    expect(a.secondChance).toBe(false);
    expect(a.busted).toBe(false);
    expect(state.secondChanceStats.blockedNumbers).toEqual([7]);
    expect(state.secondChanceStats.discardPile.some((entry) => entry.includes("擋下 7"))).toBe(true);
  });

  test("Second Chance stats are reset when a new round starts", () => {
    const { state, sockets } = setupPlayers(2);
    const [wsA] = sockets;

    state.secondChanceStats.appearedCount = 3;
    state.secondChanceStats.blockedNumbers = [2, 7];
    state.secondChanceStats.discardPile = ["A 抽到第二次機會", "A 第二次機會擋下 7"];

    act(state, wsA, "startNewRound");

    expect(state.round).toBe(2);
    expect(state.secondChanceStats.appearedCount).toBe(0);
    expect(state.secondChanceStats.blockedNumbers).toEqual([]);
    expect(state.secondChanceStats.discardPile).toEqual([]);
  });

  test("Tie at >=200 enters overtime until unique winner", () => {
    const { state, sockets, players } = setupPlayers(2);
    const [a, b] = players;
    const [wsA] = sockets;

    a.totalScore = 195;
    b.totalScore = 195;
    a.roundScore = 10;
    b.roundScore = 10;
    a.busted = false;
    b.busted = false;

    act(state, wsA, "startNewRound");
    expect(a.totalScore).toBe(205);
    expect(b.totalScore).toBe(205);
    expect(state.winner).toBeNull();
    expect(state.gameStarted).toBe(true);
    expect(state.round).toBe(2);
    expect(state.message.includes("延長賽")).toBe(true);
  });
});
