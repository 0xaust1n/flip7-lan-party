import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";

import { LOCALES, getInitialLocale, persistLocale, t as i18n, translateCardLabel } from "./i18n";

const html = htm.bind(React.createElement);
const roomFromQuery = (new URLSearchParams(window.location.search).get("room") || "").trim();
const HAS_SELECTED_ROOM = roomFromQuery.length > 0;
const ROOM = HAS_SELECTED_ROOM ? roomFromQuery : "main";
const USER_KEY = "flip7_user_uuid";
const LEGACY_USER_KEY = "uid";
const UID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

function makeSessionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `sid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStoredId(value) {
  const id = String(value || "").trim();
  return id ? id : "";
}

function readCookie(name) {
  const target = `${encodeURIComponent(name)}=`;
  const parts = document.cookie ? document.cookie.split("; ") : [];
  for (const part of parts) {
    if (part.startsWith(target)) {
      try {
        return decodeURIComponent(part.slice(target.length));
      } catch {
        return part.slice(target.length);
      }
    }
  }
  return "";
}

function writeCookie(name, value) {
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    `Max-Age=${UID_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax"
  ];
  if (window.location.protocol === "https:") {
    parts.push("Secure");
  }
  document.cookie = parts.join("; ");
}

function persistUserId(userId) {
  const id = normalizeStoredId(userId);
  if (!id) return "";
  try {
    localStorage.setItem(USER_KEY, id);
    localStorage.setItem(LEGACY_USER_KEY, id);
  } catch {
    // Ignore localStorage access errors.
  }
  writeCookie(USER_KEY, id);
  return id;
}

function getUserId() {
  let fromStorage = "";
  try {
    fromStorage = normalizeStoredId(localStorage.getItem(USER_KEY));
    if (!fromStorage) {
      fromStorage = normalizeStoredId(localStorage.getItem(LEGACY_USER_KEY));
    }
  } catch {
    // Ignore localStorage access errors.
  }

  if (fromStorage) return persistUserId(fromStorage);

  const fromCookie = normalizeStoredId(readCookie(USER_KEY));
  if (fromCookie) return persistUserId(fromCookie);

  return persistUserId(makeSessionId());
}

const USER_ID = getUserId();

function connectionBadge(status) {
  if (status === "connected") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  if (status === "reconnecting") return "bg-amber-500/20 text-amber-300 border-amber-500/40";
  return "bg-slate-700 text-slate-300 border-slate-500";
}

function connectionLabel(status, t) {
  if (status === "connected") return t("connectionConnected");
  if (status === "reconnecting") return t("connectionReconnecting");
  return t("connectionConnecting");
}

function LanguageSelector({ locale, onChange, t }) {
  return html`
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950/80 p-1 text-xs">
      <span className="px-2 text-slate-400">${t("languageLabel")}</span>
      ${LOCALES.map((option) => html`
        <button
          key=${option.code}
          onClick=${() => onChange(option.code)}
          className=${`rounded-full px-2.5 py-1 font-semibold transition ${
            locale === option.code
              ? "bg-cyan-500 text-slate-950"
              : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          ${t(option.labelKey)}
        </button>
      `)}
    </div>
  `;
}

function TimerBar({ turnStartedAt }) {
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (!turnStartedAt) {
      setTimeLeft(30);
      return;
    }

    const update = () => {
      const now = Date.now();
      const elapsed = Math.floor((now - turnStartedAt) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setTimeLeft(remaining);
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [turnStartedAt]);

  const percentage = (timeLeft / 30) * 100;
  const barColor = timeLeft <= 5 ? "bg-rose-500" : timeLeft <= 10 ? "bg-amber-500" : "bg-emerald-500";

  return html`
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className=${`timer-bar h-full ${barColor}`}
        style=${{ width: `${percentage}%` }}
      />
    </div>
  `;
}

function App() {
  const [locale, setLocale] = useState(getInitialLocale);
  const t = useMemo(() => (key, params = {}) => i18n(locale, key, params), [locale]);
  const localeRef = useRef(locale);

  const [game, setGame] = useState(null);
  const [status, setStatus] = useState(HAS_SELECTED_ROOM ? "connecting" : "idle");
  const [error, setError] = useState("");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [draftNames, setDraftNames] = useState({});
  const [you, setYou] = useState({ clientId: "", claimedPlayerId: null });
  const [toasts, setToasts] = useState([]);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const toastTimersRef = useRef(new Map());
  const toastSeqRef = useRef(0);
  const lastGameMessageRef = useRef("");

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => {
    persistLocale(locale);
    const params = new URLSearchParams(window.location.search);
    params.set("lang", locale);
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);

    document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
    document.title = i18n(locale, "appTitle");
  }, [locale]);

  useEffect(() => {
    if (!HAS_SELECTED_ROOM) return;

    let stopped = false;

    const connect = () => {
      if (stopped) return;

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(
        `${protocol}://${window.location.host}/ws?room=${encodeURIComponent(ROOM)}&userId=${encodeURIComponent(USER_ID)}&lang=${encodeURIComponent(localeRef.current)}`
      );
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        setStatus("connected");
        setError("");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "state") {
            setGame(data.state);
            setYou(data.you || { clientId: "", claimedPlayerId: null });
          } else if (data.type === "error") {
            setError(data.message || i18n(localeRef.current, "errorsServer"));
          }
        } catch {
          setError(i18n(localeRef.current, "errorsParseResponse"));
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setStatus("reconnecting");
        reconnectTimerRef.current = setTimeout(connect, 1200);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!game) return;
    setDraftNames((prev) => {
      const next = { ...prev };
      game.players.forEach((player) => {
        if (next[player.id] === undefined) {
          next[player.id] = player.name;
        }
      });
      return next;
    });
  }, [game]);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timerId) => {
        clearTimeout(timerId);
      });
      toastTimersRef.current.clear();
    };
  }, []);

  const currentPlayer = useMemo(() => {
    if (!game) return null;
    return game.players.find((player) => player.id === game.currentTurnPlayerId) || null;
  }, [game]);

  const myPlayer = useMemo(() => {
    if (!game || !you.claimedPlayerId) return null;
    return game.players.find((player) => player.id === you.claimedPlayerId) || null;
  }, [game, you.claimedPlayerId]);

  const leaderboard = useMemo(() => {
    if (!game) return [];
    const sortingLocale = locale === "en" ? "en" : "zh-Hant";
    return [...game.players].sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.roundScore !== a.roundScore) return b.roundScore - a.roundScore;
      return a.name.localeCompare(b.name, sortingLocale);
    });
  }, [game, locale]);

  const isAdmin = Boolean(game && myPlayer && game.adminPlayerId === myPlayer.id);
  const pendingFreeze = game ? game.pendingFreeze : null;
  const pendingFreezeChooserId = pendingFreeze ? pendingFreeze.chooserPlayerId : null;
  const isMyPendingFreeze = Boolean(
    pendingFreezeChooserId && myPlayer && pendingFreezeChooserId === myPlayer.id
  );
  const pendingFlipThree = game ? game.pendingFlipThree : null;
  const pendingFlipThreeOwnerId = pendingFlipThree ? pendingFlipThree.sourcePlayerId : null;
  const isMyPendingFlipThree = Boolean(
    pendingFlipThreeOwnerId && myPlayer && pendingFlipThreeOwnerId === myPlayer.id
  );
  const secondChanceStats = game
    ? game.secondChanceStats || { appearedCount: 0, blockedNumbers: [], discardPile: [] }
    : { appearedCount: 0, blockedNumbers: [], discardPile: [] };

  const pushToast = (text, kind = "info") => {
    const message = String(text || "").trim();
    if (!message) return;
    const id = `${Date.now()}-${toastSeqRef.current++}`;
    setToasts((prev) => [...prev.slice(-3), { id, text: message, kind }]);
    const timerId = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      toastTimersRef.current.delete(id);
    }, kind === "error" ? 5000 : 3500);
    toastTimersRef.current.set(id, timerId);
  };

  useEffect(() => {
    if (!game || !game.message) return;
    if (lastGameMessageRef.current === game.message) return;
    lastGameMessageRef.current = game.message;
    pushToast(game.message, "info");
  }, [game ? game.message : ""]);

  useEffect(() => {
    if (!error) return;
    pushToast(error, "error");
    setError("");
  }, [error]);

  const sendAction = (action, payload = {}) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError(t("errorsNotConnected"));
      return;
    }
    wsRef.current.send(JSON.stringify({ type: "action", action, payload }));
  };

  const onSubmitAddPlayer = (event) => {
    event.preventDefault();
    if (myPlayer) return;
    const name = newPlayerName.trim();
    if (!name) return;
    sendAction("addPlayer", { name });
    setNewPlayerName("");
  };

  const onRenameCommit = (playerId) => {
    if (!game) return;
    const player = game.players.find((p) => p.id === playerId);
    if (!player) return;
    if (you.claimedPlayerId !== playerId) return;

    const draft = (draftNames[playerId] ?? "").trim();
    if (!draft) {
      setDraftNames((prev) => ({ ...prev, [playerId]: player.name }));
      return;
    }
    if (draft !== player.name) {
      sendAction("renamePlayer", { playerId, name: draft });
    }
  };

  const onSubmitJoinRoom = (event) => {
    event.preventDefault();
    const room = roomInput.trim().slice(0, 64);
    if (!room) return;
    const params = new URLSearchParams(window.location.search);
    params.set("room", room);
    params.set("lang", locale);
    window.location.search = params.toString();
  };

  if (!HAS_SELECTED_ROOM) {
    return html`
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-8">
        <section className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-xl backdrop-blur-sm">
          <div className="mb-4 flex justify-end">
            <${LanguageSelector} locale=${locale} onChange=${setLocale} t=${t} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-cyan-400">${t("appTitle")}</h1>
          <p className="mt-2 text-sm text-slate-300">${t("joinPrompt")}</p>

          <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit=${onSubmitJoinRoom}>
            <input
              type="text"
              value=${roomInput}
              onChange=${(e) => setRoomInput(e.target.value)}
              maxLength="64"
              placeholder=${t("roomPlaceholder")}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
              required
            />
            <button
              type="submit"
              className="whitespace-nowrap rounded-lg bg-cyan-500 px-4 py-2 font-bold text-slate-950 transition hover:bg-cyan-400"
            >
              ${t("joinRoomButton")}
            </button>
          </form>
        </section>
      </main>
    `;
  }

  return html`
    <main className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-cyan-400 sm:text-3xl">${t("appTitle")}</h1>
            <p className="mt-1 text-sm text-slate-300">${t("roomLabel")}：<span className="font-semibold text-slate-100">${ROOM}</span></p>
            <p className="mt-1 text-xs text-slate-400">${t("mySeatLabel")}：<span className="font-semibold">${myPlayer ? myPlayer.name : t("mySeatNotJoined")}</span></p>
          </div>
          <div className="space-y-2">
            <div className="flex justify-end">
              <${LanguageSelector} locale=${locale} onChange=${setLocale} t=${t} />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className=${`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${connectionBadge(status)}`}>
                ${connectionLabel(status, t)}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
                ${t("roundPill", { round: game ? game.round : "-" })}
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
                ${game && game.gameStarted ? t("gameInProgress") : t("gameWaiting")}
              </span>
            </div>
          </div>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <h2 className="text-lg font-semibold">${t("gameTableTitle")}</h2>
            <p className="text-xs text-slate-400">${t("playersCount", { count: game ? game.players.length : 0, max: 6 })}</p>
          </div>

          ${!myPlayer && game && !game.gameStarted
            ? html`
                <form className="mb-6 flex flex-col gap-3 sm:flex-row" onSubmit=${onSubmitAddPlayer}>
                  <div className="sm:w-[75%]">
                    <input
                      type="text"
                      value=${newPlayerName}
                      onChange=${(e) => setNewPlayerName(e.target.value)}
                      maxLength="20"
                      placeholder=${t("nicknamePlaceholder")}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                      required
                    />
                  </div>
                  <div className="sm:w-[25%]">
                    <button
                      type="submit"
                      disabled=${status !== "connected" || game.players.length >= 6}
                      className="w-full whitespace-nowrap rounded-lg bg-cyan-500 py-2 font-bold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      ${t("joinBattle")}
                    </button>
                  </div>
                </form>
              `
            : null}

          <div className="grid gap-4 sm:grid-cols-2">
            ${!game || game.players.length === 0
              ? html`<div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-800 py-10 text-slate-500 sm:col-span-2">${t("noPlayers")}</div>`
              : game.players.map((player) => {
                  const isCurrentTurn = game.currentTurnPlayerId === player.id;
                  const isMine = you.claimedPlayerId === player.id;
                  const isActive = isCurrentTurn && !player.busted && !player.passed;

                  let cardClass = "player-card border-slate-700 bg-slate-950/60";
                  if (player.busted) cardClass = "player-card border-rose-500/50 bg-rose-500/5 grayscale-[0.5]";
                  if (player.passed) cardClass = "player-card border-amber-500/50 bg-amber-500/5";
                  if (isCurrentTurn && !game.winner) cardClass += " active-turn";

                  return html`
                    <article key=${player.id} className=${`rounded-xl border p-4 ${cardClass}`}>
                      <div className="mb-3 flex items-start justify-between">
                        <div className="flex-1">
                          <input
                            value=${draftNames[player.id] ?? player.name}
                            onChange=${(e) => setDraftNames((prev) => ({ ...prev, [player.id]: e.target.value }))}
                            onBlur=${() => onRenameCommit(player.id)}
                            className="w-full truncate border-none bg-transparent text-lg font-bold text-slate-100 focus:outline-none disabled:cursor-default"
                            disabled=${!isMine || !!game.winner}
                          />
                          <p className=${`text-xs ${isActive ? "text-emerald-400 font-semibold" : "text-slate-500"}`}>
                            ${player.busted
                              ? t("playerStateBusted")
                              : player.passed
                                ? t("playerStatePassed")
                                : isActive
                                  ? t("playerStateActive")
                                  : t("playerStateWaiting")}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-xl font-bold text-cyan-400">${player.roundScore}</span>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500">${t("roundScoreLabel")}</span>
                        </div>
                      </div>

                      ${isActive && !game.winner ? html`<${TimerBar} turnStartedAt=${game.turnStartedAt} />` : null}

                      <div className="mt-4 flex flex-wrap gap-1.5">
                        ${player.cards.length === 0
                          ? html`<span className="text-xs italic text-slate-600">${t("noCards")}</span>`
                          : player.cards.map((card, idx) => html`
                              <span key=${`${player.id}-${card}-${idx}`} className="card-item inline-flex rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 shadow-sm">
                                ${translateCardLabel(locale, card)}
                              </span>
                            `)}
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
                        <span>${t("totalScoreLabel")}: <b className="text-slate-200">${player.totalScore}</b></span>
                        <span>${player.secondChance ? html`<span className="text-emerald-400">★ ${t("secondChanceLabel")}</span>` : ""}</span>
                      </div>

                      ${isMine && isActive && !game.winner && !pendingFlipThree && !pendingFreeze
                        ? html`
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              <button
                                onClick=${() => sendAction("dealSelf")}
                                className="rounded-lg bg-cyan-500 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
                              >
                                ${t("actionDeal")}
                              </button>
                              <button
                                onClick=${() => sendAction("passSelf")}
                                className="rounded-lg border border-amber-500/50 py-2.5 text-sm font-bold text-amber-300 transition hover:bg-amber-500/10"
                              >
                                ${t("actionPass")}
                              </button>
                            </div>
                          `
                        : null}

                      ${isMine && isMyPendingFlipThree && !game.winner
                        ? html`
                            <div className="mt-4 space-y-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
                              <p className="text-[10px] font-bold uppercase text-cyan-300">${t("selectFlipThreeTarget")}</p>
                              <div className="flex flex-wrap gap-2">
                                ${game.players
                                  .filter((target) => !target.busted && !target.passed)
                                  .map((target) => html`
                                    <button
                                      key=${target.id}
                                      onClick=${() => sendAction("selectFlipThreeTarget", { targetPlayerId: target.id })}
                                      className="rounded bg-cyan-500/20 px-2 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/40"
                                    >
                                      ${target.name}
                                    </button>
                                  `)}
                              </div>
                            </div>
                          `
                        : null}

                      ${isMine && isMyPendingFreeze && !game.winner
                        ? html`
                            <div className="mt-4 space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                              <p className="text-[10px] font-bold uppercase text-rose-300">${t("selectFreezeTarget")}</p>
                              <div className="flex flex-wrap gap-2">
                                ${game.players
                                  .filter((target) => !target.busted && !target.passed)
                                  .map((target) => html`
                                    <button
                                      key=${target.id}
                                      onClick=${() => sendAction("resolveFreezeTarget", { targetPlayerId: target.id })}
                                      className="rounded bg-rose-500/20 px-2 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/40"
                                    >
                                      ${target.name}
                                    </button>
                                  `)}
                              </div>
                            </div>
                          `
                        : null}
                    </article>
                  `;
                })}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold border-b border-slate-800 pb-2">${t("leaderboardTitle")}</h2>
            ${leaderboard.length === 0
              ? html`<p className="text-sm text-slate-500">${t("noScore")}</p>`
              : html`
                  <ol className="space-y-2">
                    ${leaderboard.map((player, index) => {
                      const isMe = you.claimedPlayerId === player.id;
                      const isWinner = Boolean(game && game.winner && game.winner.id === player.id);

                      return html`
                        <li
                          key=${`rank-${player.id}`}
                          className=${`flex items-center justify-between rounded-lg border px-3 py-2 ${
                            isWinner
                              ? "border-cyan-500/50 bg-cyan-500/10"
                              : isMe
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-slate-800 bg-slate-950"
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-mono text-xs text-slate-400">#${index + 1}</span>
                            <span className="truncate text-sm font-semibold text-slate-100">${player.name}</span>
                            ${isMe ? html`<span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">${t("meTag")}</span>` : null}
                            ${isWinner ? html`<span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">${t("winnerTag")}</span>` : null}
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-sm font-bold text-slate-100">${player.totalScore}</p>
                            <p className="text-[10px] text-slate-500">${t("roundScoreInline", { score: player.roundScore })}</p>
                          </div>
                        </li>
                      `;
                    })}
                  </ol>
                `}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold border-b border-slate-800 pb-2">${t("adminPanelTitle")}</h2>
            ${isAdmin
              ? html`
                  <div className="space-y-3">
                    <button
                      onClick=${() => sendAction("startGame")}
                      className="w-full rounded-xl bg-cyan-500 py-3 font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400 disabled:opacity-50"
                    >
                      ${game && game.gameStarted ? t("restartGame") : t("startNewGame")}
                    </button>
                    <button
                      onClick=${() => sendAction("startNewRound")}
                      disabled=${!game || !game.gameStarted || !!game.winner || !!pendingFlipThree || !!pendingFreeze}
                      className="w-full rounded-xl bg-emerald-500 py-3 font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50"
                    >
                      ${t("manualStartRound")}
                    </button>
                    <button
                      onClick=${() => sendAction("resetGame")}
                      className="w-full rounded-xl border border-slate-700 py-3 font-bold text-slate-400 transition hover:border-rose-500/50 hover:text-rose-400"
                    >
                      ${t("resetRoom")}
                    </button>
                  </div>
                `
              : html`
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-center">
                    <p className="text-sm text-slate-500">${t("adminOnlyTip")}</p>
                  </div>
                `}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold border-b border-slate-800 pb-2">${t("statsTitle")}</h2>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">${t("remainingDeck")}</span>
                <span className="font-mono font-bold text-slate-100">${game ? game.deckCount : "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">${t("secondChanceCount")}</span>
                <span className="font-mono font-bold text-emerald-400">${secondChanceStats.appearedCount}</span>
              </div>
              <div>
                <span className="text-xs text-slate-500">${t("blockedNumbers")}</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  ${secondChanceStats.blockedNumbers.length === 0
                    ? html`<span className="text-[10px] text-slate-600 italic">${t("none")}</span>`
                    : secondChanceStats.blockedNumbers.map((n, i) => html`<span key=${i} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px]">${n}</span>`)}
                </div>
              </div>
              <div className="rounded-lg bg-slate-950 p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">${t("recentActivity")}</p>
                <div className="max-h-32 space-y-1 overflow-y-auto pr-1 text-[11px] text-slate-400">
                  ${secondChanceStats.discardPile.length === 0
                    ? html`<p className="italic text-slate-600">${t("noRecords")}</p>`
                    : secondChanceStats.discardPile
                        .slice()
                        .reverse()
                        .map((log, i) => html`<p key=${i} className="border-l border-slate-800 pl-2 py-0.5">${log}</p>`)}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
            <h2 className="mb-4 text-lg font-semibold text-amber-500 border-b border-slate-800 pb-2">${t("rulesTitle")}</h2>
            <div className="space-y-3 text-[11px] leading-relaxed text-slate-400">
              <p><b className="text-slate-200">${t("ruleDeckDistTitle")}</b>${t("ruleDeckDistBody")}</p>
              <p><b className="text-slate-200">${t("ruleSpecialTitle")}</b>${t("ruleSpecialBody")}</p>
              <p><b className="text-slate-200">${t("ruleTimeoutTitle")}</b>${t("ruleTimeoutBody")}</p>
              <p><b className="text-slate-200">${t("ruleWinTitle")}</b>${t("ruleWinBody")}</p>
            </div>
          </div>
        </aside>
      </section>
    </main>

    <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex flex-col items-center gap-2 px-4">
      ${toasts.map((toast) => html`
        <div key=${toast.id} className=${`toast-item pointer-events-auto max-w-md rounded-xl border px-5 py-3 text-sm font-medium shadow-2xl backdrop-blur-md ${
          toast.kind === "error" ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : "border-cyan-500/50 bg-slate-900/90 text-cyan-100"
        }`}>
          ${toast.text}
        </div>
      `)}
    </div>

    ${game && game.winner
      ? html`
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md animate-bounce-short rounded-3xl border border-cyan-500/30 bg-slate-900 p-8 text-center shadow-[0_0_50px_rgba(34,211,238,0.2)]">
              <div className="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full bg-cyan-500/10 text-4xl">🏆</div>
              <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-400">${t("winnerCongrats")}</h2>
              <h3 className="mt-2 text-3xl font-black text-slate-100">${game.winner.name}</h3>
              <p className="mt-4 text-slate-400">${t("winnerTotalScore")}：<span className="text-2xl font-bold text-slate-100">${game.winner.totalScore}</span></p>
              ${isAdmin
                ? html`
                    <button onClick=${() => sendAction("startGame")} className="mt-8 w-full rounded-xl bg-cyan-500 py-4 font-black text-slate-950 transition hover:bg-cyan-400">
                      ${t("openNewGame")}
                    </button>
                  `
                : null}
            </div>
          </div>
        `
      : null}
  `;
}

const root = createRoot(document.getElementById("app"));
root.render(html`<${App} />`);
