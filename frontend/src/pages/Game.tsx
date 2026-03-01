import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Reorder, AnimatePresence, motion } from 'framer-motion';
import { useWebSocket } from '../lib/WebSocketContext';
import { Card, type CardData } from '../components/Card';
import { SortingZone, type SortingCard } from '../components/SortingZone';
import { detectCombos, isBajadaComplete, isDescendingEscala } from '../lib/comboDetection';
import './Game.css';

const BOT_DISPLAY_NAMES: Record<string, string> = {
    'bot_easy': '🤖 Easy Bot',
    'bot_medium': '🧠 Medium Bot',
    'bot_hard': '💀 Hard Bot',
};

function getPlayerDisplayName(id: string): string {
    if (BOT_DISPLAY_NAMES[id]) return BOT_DISPLAY_NAMES[id];
    return id.length > 10 ? id.slice(0, 6) + '…' : id;
}

function getActionLabel(actionType: string, playerName: string, card: CardData | null): string {
    switch (actionType) {
        case 'drew_from_deck': return `${playerName} drew from Mazo`;
        case 'drew_from_pozo': {
            if (card && card !== 'Joker' && typeof card === 'object' && 'Standard' in card) {
                const v = card.Standard.value;
                const s = card.Standard.suit === 'Hearts' ? '♥' : card.Standard.suit === 'Diamonds' ? '♦' : card.Standard.suit === 'Clubs' ? '♣' : '♠';
                return `${playerName} took ${v} ${s} from Pozo`;
            }
            return `${playerName} drew from Pozo`;
        }
        case 'discarded': {
            if (card && card !== 'Joker' && typeof card === 'object' && 'Standard' in card) {
                const v = card.Standard.value;
                const s = card.Standard.suit === 'Hearts' ? '♥' : card.Standard.suit === 'Diamonds' ? '♦' : card.Standard.suit === 'Clubs' ? '♣' : '♠';
                return `${playerName} discarded ${v} ${s}`;
            }
            if (card === 'Joker') return `${playerName} discarded Joker`;
            return `${playerName} discarded`;
        }
        case 'bajó': return `${playerName} ¡bajó! 🎉`;
        case 'shed': return `${playerName} shed a card`;
        default: return `${playerName} played`;
    }
}

interface HandCard {
    id: string;
    card: CardData;
}

export default function Game() {
    const [, setLocation] = useLocation();
    const { gameState, roundEndData, clearRoundEndData, disconnect, sendAction, error, clearError } = useWebSocket();
    const username = localStorage.getItem('username') || '';

    let userId = localStorage.getItem('user_id') || '';
    if (!userId) {
        const token = localStorage.getItem('token');
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                userId = payload.sub;
            } catch (e) { console.error("Could not parse JWT token", e); }
        }
    }

    // ─── State ───────────────────────────────────────────────
    const [showScoreboard, setShowScoreboard] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isDraggingOverPozo, setIsDraggingOverPozo] = useState(false);
    const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
    const [handCards, setHandCards] = useState<HandCard[]>([]);
    const [sortingZoneCards, setSortingZoneCards] = useState<SortingCard[]>([]);
    const [isSortingZoneDropActive, setIsSortingZoneDropActive] = useState(false);

    // Action feed
    const [actionFeedEntry, setActionFeedEntry] = useState<{ key: number; text: string } | null>(null);
    const actionFeedCounter = useRef(0);
    const lastActionRef = useRef<string | null>(null);

    // Error toast
    const [errorToast, setErrorToast] = useState<{ key: number; text: string } | null>(null);
    const errorToastCounter = useRef(0);

    // Refs
    const pozoRef = useRef<HTMLDivElement>(null);
    const centralTableRef = useRef<HTMLDivElement>(null);
    const sortingZoneRef = useRef<HTMLDivElement>(null);
    const dragOverlayRef = useRef<HTMLDivElement>(null);
    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // ─── Derived State ───────────────────────────────────────
    const me = gameState?.players.find(p => p.id === userId);
    const isMyTurn = gameState ? (me && gameState.players.indexOf(me) === gameState.current_turn_index) : false;
    const hasDrawn = me?.has_drawn_this_turn ?? false;
    const canDraw = isMyTurn && !hasDrawn;
    const isFirstTurn = (me?.turns_played ?? 0) === 0;
    const canBajar = isMyTurn && hasDrawn && !isFirstTurn && !(me?.has_dropped_hand);
    const canShed = isMyTurn && hasDrawn && (me?.has_dropped_hand === true) && !(me?.dropped_hand_this_turn);

    const currentTurnPlayer = gameState?.players[gameState.current_turn_index];
    const currentTurnName = currentTurnPlayer ? getPlayerDisplayName(currentTurnPlayer.id) : '';

    // Combo detection
    const sortingZoneCombos = useMemo(
        () => detectCombos(sortingZoneCards.map(c => c.card)),
        [sortingZoneCards]
    );

    const handCombos = useMemo(
        () => detectCombos(handCards.map(h => h.card)),
        [handCards]
    );

    const bajadaReady = useMemo(() => {
        if (!gameState || !canBajar) return false;
        return isBajadaComplete(sortingZoneCombos, gameState.required_trios, gameState.required_escalas);
    }, [sortingZoneCombos, gameState, canBajar]);

    // Auto-sort descending escalas
    useEffect(() => {
        let changed = false;
        const newCards = [...sortingZoneCards];
        sortingZoneCombos.forEach(combo => {
            if (combo.type === 'escala') {
                const comboCards = newCards.slice(combo.startIndex, combo.endIndex + 1);
                if (isDescendingEscala(comboCards.map(c => c.card))) {
                    comboCards.reverse();
                    newCards.splice(combo.startIndex, comboCards.length, ...comboCards);
                    changed = true;
                }
            }
        });
        if (changed) setSortingZoneCards(newCards);
    }, [sortingZoneCards, sortingZoneCombos]);

    // ─── Action Feed: show opponent actions ──────────────────
    useEffect(() => {
        if (!gameState?.last_action) return;
        const action = gameState.last_action;
        // Skip showing our own actions
        if (action.player_id === userId) return;
        // Avoid duplicate fires for the same action
        const actionKey = `${action.player_id}-${action.action_type}-${JSON.stringify(action.card)}`;
        if (lastActionRef.current === actionKey) return;
        lastActionRef.current = actionKey;

        const playerName = getPlayerDisplayName(action.player_id);
        const text = getActionLabel(action.action_type, playerName, action.card);
        actionFeedCounter.current += 1;
        setActionFeedEntry({ key: actionFeedCounter.current, text });

        const timeout = setTimeout(() => setActionFeedEntry(null), 3000);
        return () => clearTimeout(timeout);
    }, [gameState?.last_action, userId]);

    // ─── Error Toast ─────────────────────────────────────────
    useEffect(() => {
        if (!error) return;
        errorToastCounter.current += 1;
        setErrorToast({ key: errorToastCounter.current, text: error });
        const timeout = setTimeout(() => { setErrorToast(null); clearError(); }, 3000);
        return () => clearTimeout(timeout);
    }, [error, clearError]);

    // Action hint text for status bar
    const getActionHint = (): string => {
        if (!isMyTurn) return '';
        if (canDraw) return 'Click Mazo or Pozo to draw';
        if (isFirstTurn) return 'Drag a card to Pozo to discard';
        if (canShed) return 'Shed cards to combos or discard';
        if (me?.has_dropped_hand) return 'Drag a card to Pozo to discard';
        if (bajadaReady) return 'Bajada ready! Click ¡Bajar!';
        return 'Organize combos, then discard';
    };

    // ─── Sync hand with server ───────────────────────────────
    const localCardsRef = useRef<{ hand: HandCard[], sortingZone: SortingCard[] }>({ hand: handCards, sortingZone: sortingZoneCards });
    useEffect(() => {
        localCardsRef.current = { hand: handCards, sortingZone: sortingZoneCards };
    }, [handCards, sortingZoneCards]);

    useEffect(() => {
        if (!gameState) return;
        const serverCards = gameState.my_hand;
        const currentLocal = localCardsRef.current;

        const allLocalCards = [...currentLocal.hand.map(h => h.card), ...currentLocal.sortingZone.map(s => s.card)];
        const serverCardsStr = serverCards.map(c => JSON.stringify(c)).join('|');
        const localCardsStr = allLocalCards.map(c => JSON.stringify(c)).join('|');
        if (serverCardsStr === localCardsStr) return;

        const serverCardsLeft = [...serverCards];
        const newSortingZone: SortingCard[] = [];

        for (const existingSz of currentLocal.sortingZone) {
            const matchIndex = serverCardsLeft.findIndex(c => JSON.stringify(c) === JSON.stringify(existingSz.card));
            if (matchIndex !== -1) {
                newSortingZone.push(existingSz);
                serverCardsLeft.splice(matchIndex, 1);
            }
        }

        const newHand: HandCard[] = [];
        for (const existingHand of currentLocal.hand) {
            const matchIndex = serverCardsLeft.findIndex(c => JSON.stringify(c) === JSON.stringify(existingHand.card));
            if (matchIndex !== -1) {
                newHand.push(existingHand);
                serverCardsLeft.splice(matchIndex, 1);
            }
        }

        for (const newCard of serverCardsLeft) {
            newHand.push({ id: crypto.randomUUID(), card: newCard });
        }

        const newSortingZoneStr = newSortingZone.map(c => c.id).join('|');
        const currentSortingZoneStr = currentLocal.sortingZone.map(c => c.id).join('|');
        if (newSortingZoneStr !== currentSortingZoneStr) setSortingZoneCards(newSortingZone);

        const newHandStr = newHand.map(c => c.id).join('|');
        const currentHandStr = currentLocal.hand.map(c => c.id).join('|');
        if (newHandStr !== currentHandStr) setHandCards(newHand);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState?.my_hand, gameState?.players]);

    // Auto-dismiss Round End Modal
    useEffect(() => {
        if (gameState && !gameState.is_waiting_for_next_round && roundEndData) {
            clearRoundEndData();
        }
    }, [gameState?.is_waiting_for_next_round, roundEndData, clearRoundEndData]);

    // ─── Bajar Handler ───────────────────────────────────────
    const handleBajar = useCallback(() => {
        if (!canBajar || !gameState || !bajadaReady) return;
        const submissionCombos: CardData[][] = [];
        sortingZoneCombos.forEach(combo => {
            submissionCombos.push(sortingZoneCards.slice(combo.startIndex, combo.endIndex + 1).map(sc => sc.card));
        });
        if (submissionCombos.length === 0) return;
        sendAction({ type: 'DropHand', payload: { combinations: submissionCombos } });

        const usedSortingIndices = new Set<number>();
        sortingZoneCombos.forEach(c => {
            for (let i = c.startIndex; i <= c.endIndex; i++) usedSortingIndices.add(i);
        });
        setSortingZoneCards(sortingZoneCards.filter((_, i) => !usedSortingIndices.has(i)));
    }, [canBajar, gameState, bajadaReady, sortingZoneCombos, sortingZoneCards, sendAction]);

    // ─── Drag handling ───────────────────────────────────────
    const [dragOverlayCard, setDragOverlayCard] = useState<CardData | null>(null);

    const handleMotionDragStart = (id: string, card: CardData) => {
        setDraggingCardId(id);
        setDragOverlayCard(card);
    };

    const getEventCoords = (event: unknown): { x: number; y: number } => {
        const ev = event as { clientX?: number; clientY?: number; touches?: Array<{ clientX: number; clientY: number }>; changedTouches?: Array<{ clientX: number; clientY: number }> };
        if (ev.clientX !== undefined) return { x: ev.clientX, y: ev.clientY! };
        if (ev.touches && ev.touches.length > 0) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        if (ev.changedTouches && ev.changedTouches.length > 0) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
        return { x: 0, y: 0 };
    };

    const isInsideRect = (x: number, y: number, rect: DOMRect) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    const handleMotionDragEnd = useCallback((id: string, card: CardData, event: unknown) => {
        setDraggingCardId(null);
        setDragOverlayCard(null);
        setIsDraggingOverPozo(false);
        setIsSortingZoneDropActive(false);

        if (!isMyTurn || !gameState) return;
        const { x, y } = getEventCoords(event);

        // Sorting zone
        if (sortingZoneRef.current) {
            const szRect = sortingZoneRef.current.getBoundingClientRect();
            if (isInsideRect(x, y, szRect)) {
                const handCard = handCards.find(c => c.id === id);
                if (handCard) {
                    setHandCards(prev => prev.filter(c => c.id !== id));
                    setSortingZoneCards(prev => [...prev, { id: handCard.id, card: handCard.card }]);
                }
                return;
            }
        }

        if (!hasDrawn) return;

        // Pozo
        if (pozoRef.current) {
            const pozoRect = pozoRef.current.getBoundingClientRect();
            if (isInsideRect(x, y, pozoRect)) {
                const serverIdx = gameState.my_hand.findIndex(c => JSON.stringify(c) === JSON.stringify(card));
                if (serverIdx !== -1) {
                    setHandCards(prev => prev.filter(c => c.id !== id));
                    setSortingZoneCards(prev => prev.filter(c => c.id !== id));
                    sendAction({ type: 'Discard', payload: { card_index: serverIdx } });
                }
                return;
            }
        }

        // Central Table
        if (centralTableRef.current && canBajar && bajadaReady) {
            const tableRect = centralTableRef.current.getBoundingClientRect();
            if (isInsideRect(x, y, tableRect)) return;
        }

        // Shed
        if (canShed) {
            const elements = document.elementsFromPoint(x, y);
            const shedTarget = elements.find(el => el.hasAttribute('data-shed-player'));
            if (shedTarget) {
                const targetPlayerId = shedTarget.getAttribute('data-shed-player')!;
                const targetComboIdx = parseInt(shedTarget.getAttribute('data-shed-combo')!, 10);
                const handIndex = gameState.my_hand.findIndex(c => JSON.stringify(c) === JSON.stringify(card));
                if (handIndex !== -1) {
                    setHandCards(prev => prev.filter(c => c.id !== id));
                    setSortingZoneCards(prev => prev.filter(c => c.id !== id));
                    sendAction({
                        type: 'ShedCard',
                        payload: {
                            hand_card_index: handIndex,
                            target_player_id: targetPlayerId,
                            target_combo_idx: targetComboIdx,
                        },
                    });
                }
                return;
            }
        }
    }, [isMyTurn, hasDrawn, gameState, sendAction, handCards, canBajar, canShed, bajadaReady]);

    // Persist hand order
    useEffect(() => {
        if (!isMyTurn || !gameState || (handCards.length === 0 && sortingZoneCards.length === 0)) return;
        const serverCardsStr = gameState.my_hand.map(c => JSON.stringify(c)).join('|');
        const allLocalCards = [...handCards.map(h => h.card), ...sortingZoneCards.map(s => s.card)];
        const localCardsStr = allLocalCards.map(c => JSON.stringify(c)).join('|');
        const sameContent = [...gameState.my_hand].map(c => JSON.stringify(c)).sort().join('|') === [...allLocalCards].map(c => JSON.stringify(c)).sort().join('|');
        if (sameContent && serverCardsStr !== localCardsStr && !draggingCardId) {
            sendAction({ type: 'ReorderHand', payload: { hand: allLocalCards } });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handCards, sortingZoneCards, draggingCardId, isMyTurn, gameState?.my_hand, sendAction]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!draggingCardId) return;
        if (pozoRef.current) {
            const rect = pozoRef.current.getBoundingClientRect();
            setIsDraggingOverPozo(isInsideRect(e.clientX, e.clientY, rect));
        }
        if (sortingZoneRef.current) {
            const rect = sortingZoneRef.current.getBoundingClientRect();
            setIsSortingZoneDropActive(isInsideRect(e.clientX, e.clientY, rect));
        }
    }, [draggingCardId]);

    // ─── Sorting Zone Handlers ───────────────────────────────
    const handleReturnCardToHand = useCallback((cardId: string) => {
        const card = sortingZoneCards.find(c => c.id === cardId);
        if (!card) return;
        setSortingZoneCards(prev => prev.filter(c => c.id !== cardId));
        setHandCards(prev => [...prev, card]);
    }, [sortingZoneCards]);

    // Click a card in hand to send it to workspace
    const handleSendToWorkspace = useCallback((cardId: string) => {
        if (!isMyTurn) return;
        const card = handCards.find(c => c.id === cardId);
        if (!card) return;
        setHandCards(prev => prev.filter(c => c.id !== cardId));
        setSortingZoneCards(prev => [...prev, { id: card.id, card: card.card }]);
    }, [handCards, isMyTurn]);

    const handleSortingZoneReorder = useCallback((fromIndex: number, toIndex: number) => {
        setSortingZoneCards(prev => {
            const newCards = [...prev];
            const [moved] = newCards.splice(fromIndex, 1);
            newCards.splice(toIndex, 0, moved);
            return newCards;
        });
    }, []);

    // ─── Early Return ────────────────────────────────────────
    if (!gameState) {
        return (
            <div className="auth-container">
                <div className="auth-card">
                    <h1>Connection Lost</h1>
                    <button className="btn btn-primary" onClick={() => setLocation('/lobby')}>Return to Lobby</button>
                </div>
            </div>
        );
    }

    const handleQuit = () => { disconnect(); setLocation('/lobby'); };
    const opponents = gameState.players.filter(p => p.id !== userId);

    // Fan hand: compute per-card rotation and vertical offset
    const handOverlap = Math.max(-50, Math.min(-20, -(handCards.length * 3.2)));
    const maxFanAngle = Math.min(18, handCards.length * 1.5);

    return (
        <div className="game-container" onPointerMove={handlePointerMove}>
            {/* ─── Status Bar ─── */}
            <div className="game-status-bar">
                <div className="status-bar-left">
                    <span className="status-round-pill">
                        R{gameState.current_round_index + 1} — {gameState.current_round_rules}
                    </span>
                    <div className={`status-turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
                        <span className="turn-dot" />
                        <span>{isMyTurn ? 'Your Turn' : `${currentTurnName}'s turn`}</span>
                    </div>
                </div>
                <div className="status-bar-right">
                    {isMyTurn && (
                        <span className="status-action-hint active">{getActionHint()}</span>
                    )}
                    <button className="status-btn" onClick={() => setShowScoreboard(true)}>🏆</button>
                </div>
            </div>

            {/* ─── Kebab Menu ─── */}
            <div className="game-menu-container">
                <button className="kebab-btn" onClick={() => setShowMenu(!showMenu)}>⋮</button>
                {showMenu && (
                    <div className="kebab-dropdown">
                        <div className="dropdown-item user-info">👤 <b>{username}</b></div>
                        <div className="dropdown-divider" />
                        <button className="dropdown-item text-btn" onClick={() => { setShowScoreboard(true); setShowMenu(false); }}>🏆 Scoreboard</button>
                        <button className="dropdown-item text-btn" style={{ color: '#ef4444' }} onClick={handleQuit}>🚪 Quit Match</button>
                    </div>
                )}
            </div>

            {/* ─── Action Feed Toast ─── */}
            <AnimatePresence>
                {actionFeedEntry && (
                    <motion.div
                        key={actionFeedEntry.key}
                        className="action-feed"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.3 }}
                    >
                        <span className="action-feed-icon">🃏</span>
                        <span>{actionFeedEntry.text}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─── Error Toast ─── */}
            <AnimatePresence>
                {errorToast && (
                    <motion.div
                        key={errorToast.key}
                        className="error-toast"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.25 }}
                    >
                        ⚠️ {errorToast.text}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ─── Round Transition Overlay ─── */}
            {roundEndData && (
                <div className="round-transition-overlay">
                    <div className="round-transition-card">
                        <h1 className="round-transition-title">{roundEndData.is_game_over ? 'Game Over!' : 'Round Complete!'}</h1>
                        <h2 className="round-transition-subtitle">{roundEndData.round_name}</h2>

                        <div className="round-winner">
                            <span className="winner-icon">🏆</span>
                            <span className="winner-name">{getPlayerDisplayName(roundEndData.winner_id)}</span>
                            <span className="winner-label">won the round!</span>
                        </div>

                        <table className="round-scores-table">
                            <thead>
                                <tr><th>Player</th><th>Round Points</th><th>Total Points</th></tr>
                            </thead>
                            <tbody>
                                {[...roundEndData.player_scores].sort((a, b) => a.total_points - b.total_points).map(score => {
                                    const playerState = gameState.players.find(p => p.id === score.id);
                                    const isReady = playerState?.is_ready_for_next_round;
                                    return (
                                        <tr key={score.id} className={score.id === userId ? 'my-score-row' : ''}>
                                            <td>
                                                {getPlayerDisplayName(score.id)}
                                                {isReady && !roundEndData.is_game_over && <span style={{ marginLeft: '0.5rem' }} title="Ready">✅</span>}
                                            </td>
                                            <td className="round-points">+{score.round_points}</td>
                                            <td className="total-points">{score.total_points}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        <button
                            className="btn btn-primary btn-large continue-btn"
                            disabled={me?.is_ready_for_next_round && !roundEndData.is_game_over}
                            onClick={() => {
                                if (roundEndData.is_game_over) {
                                    clearRoundEndData();
                                    handleQuit();
                                } else {
                                    sendAction({ type: 'ReadyForNextRound', payload: null });
                                }
                            }}
                        >
                            {roundEndData.is_game_over
                                ? 'Return to Lobby'
                                : me?.is_ready_for_next_round ? 'Waiting for players...' : 'Start Next Round'}
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Scoreboard Modal ─── */}
            {showScoreboard && (
                <div className="scoreboard-modal-overlay" onClick={() => setShowScoreboard(false)}>
                    <div className="scoreboard-modal" onClick={e => e.stopPropagation()}>
                        <h2>Scoreboard</h2>
                        <table className="scoreboard-table">
                            <thead>
                                <tr><th>Player</th><th>Points</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                                {gameState.players.map(p => (
                                    <tr key={p.id}>
                                        <td>{getPlayerDisplayName(p.id)} {p.id === userId && '(You)'}</td>
                                        <td>{p.points}</td>
                                        <td>{p.has_dropped_hand ? '✅ Bajado' : '🎴 Playing'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ marginTop: '2rem', textAlign: 'right' }}>
                            <button className="btn btn-primary" onClick={() => setShowScoreboard(false)}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Main Board ─── */}
            <main className="game-board">
                {/* Opponents Row */}
                <div className="opponents-row">
                    {opponents.map((opp) => {
                        const isBotTurn = gameState.players.indexOf(opp) === gameState.current_turn_index;
                        return (
                            <div key={opp.id} className={`opponent-slot ${isBotTurn ? 'active-turn' : ''}`}>
                                <div className="opponent-avatar">
                                    {opp.id.startsWith('bot_') ? '🤖' : opp.id.substring(0, 2).toUpperCase()}
                                </div>
                                <span className="opponent-name">{getPlayerDisplayName(opp.id)}</span>
                                <div className="opponent-cards-row">
                                    {Array.from({ length: Math.min(opp.hand_count, 5) }).map((_, i) => (
                                        <Card key={i} card={{ Standard: { suit: 'Spades', value: 'Ace' } }} faceDown={true}
                                            style={{ width: 'var(--card-w-sm)', height: 'var(--card-h-sm)', marginLeft: i > 0 ? '-14px' : '0' }} />
                                    ))}
                                    {opp.hand_count > 5 && <span className="opponent-extra">+{opp.hand_count - 5}</span>}
                                </div>
                                <span className="opponent-card-count">
                                    {opp.hand_count} cards{opp.has_dropped_hand ? ' • bajado ✅' : ''}
                                </span>
                                {isBotTurn && (
                                    <div className="opponent-thinking">
                                        <span /><span /><span />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Main Table Area */}
                <div className="table-main-area">
                    {/* Left Side: Deck and Discard (side by side) */}
                    <div className="table-left-side">
                        <div className="deck-pozo-row">
                            {/* Mazo */}
                            <div
                                className={`deck-area ${canDraw ? 'highlight-action' : ''}`}
                                onClick={() => {
                                    if (canDraw) sendAction({ type: 'DrawFromDeck', payload: null });
                                }}
                                title={canDraw ? 'Click to draw from the Mazo' : ''}
                            >
                                <div className="deck-stack">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <Card key={i} card={{ Standard: { suit: 'Spades', value: 'Ace' } }} faceDown={true}
                                            style={{ position: 'absolute', left: i * 2, top: i * 2, width: 80, height: 112, boxShadow: (canDraw && i === 2) ? '0 0 20px var(--color-primary-main)' : undefined }} />
                                    ))}
                                </div>
                                <span className="deck-label">Mazo</span>
                            </div>

                            {/* Pozo */}
                            <div
                                ref={pozoRef}
                                className={`discard-area ${canDraw && gameState.discard_pile_top ? 'highlight-action' : ''} ${isDraggingOverPozo ? 'droppable-active' : ''}`}
                                onClick={() => {
                                    if (canDraw && gameState.discard_pile_top) {
                                        sendAction({ type: 'DrawFromDiscard', payload: null });
                                    }
                                }}
                                title={canDraw ? 'Click to draw from the Pozo' : hasDrawn ? 'Drag a card here to discard it' : ''}
                            >
                                <div className="discard-slot">
                                    {gameState.discard_pile_top ? (
                                        <Card card={gameState.discard_pile_top} style={{ width: 80, height: 112 }} />
                                    ) : (
                                        <span className="discard-empty">Pozo</span>
                                    )}
                                    {isDraggingOverPozo && (
                                        <div className="pozo-drop-overlay">Drop to discard</div>
                                    )}
                                </div>
                                <span className="deck-label">Pozo</span>
                            </div>
                        </div>
                    </div>

                    {/* Central Table — bajadas */}
                    <div ref={centralTableRef} className="central-table">
                        <div className="dropped-bajadas-area">
                            {gameState.players.filter(p => p.has_dropped_hand).map(player => (
                                <div key={player.id} className="player-bajada-row">
                                    <span className="player-bajada-name">{getPlayerDisplayName(player.id)}{player.id === userId ? ' (You)' : ''}</span>
                                    <div className="player-bajada-groups">
                                        {player.dropped_combinations.map((combo, cIdx) => {
                                            // Detect combo type for badge
                                            const comboType = combo.length >= 4 ? 'escala' : 'trio';
                                            return (
                                                <div
                                                    key={cIdx}
                                                    className={`player-bajada-group ${canShed ? 'shed-available' : ''}`}
                                                    data-shed-player={player.id}
                                                    data-shed-combo={cIdx}
                                                >
                                                    <span className={`bajada-combo-badge ${comboType}`}>
                                                        {comboType === 'trio' ? 'Trío' : 'Escala'}
                                                    </span>
                                                    {combo.map((card, idx) => (
                                                        <div key={idx} className="bajada-card-rendered">
                                                            <Card card={card} isDraggable={false}
                                                                style={{ width: 'clamp(50px, 5.5vw, 72px)', height: 'clamp(70px, 8vw, 100px)', fontSize: 'clamp(0.6rem, 0.9vw, 0.85rem)' }} />
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {gameState.players.filter(p => p.has_dropped_hand).length === 0 && (
                                <div className="central-table-empty">
                                    {canBajar
                                        ? 'Organize combos in the workspace, then click ¡Bajar!'
                                        : 'No bajadas yet this round'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Bottom Area: Hand (left) + Workspace (right) */}
                <div className="bottom-strip">
                    {/* Hand */}
                    <div className="my-hand-area">
                        <Reorder.Group
                            axis="x"
                            values={handCards}
                            onReorder={setHandCards}
                            className="my-hand"
                            style={{
                                filter: hasDrawn && isMyTurn ? 'drop-shadow(0 0 10px rgba(99, 102, 241, 0.3))' : 'none',
                                transition: 'filter 0.3s'
                            }}
                        >
                            {handCards.map((item, localIdx) => {
                                const comboForCard = handCombos.find(c => localIdx >= c.startIndex && localIdx <= c.endIndex);
                                const isComboStart = comboForCard && localIdx === comboForCard.startIndex;
                                const isComboEnd = comboForCard && localIdx === comboForCard.endIndex;

                                // Fan angle
                                const totalCards = handCards.length;
                                const centerIdx = (totalCards - 1) / 2;
                                const fanAngle = totalCards > 1 ? ((localIdx - centerIdx) / centerIdx) * maxFanAngle : 0;
                                const fanY = totalCards > 1 ? Math.abs(localIdx - centerIdx) * (totalCards > 6 ? 2.5 : 1.5) : 0;

                                return (
                                    <Reorder.Item
                                        key={item.id}
                                        value={item}
                                        drag
                                        onDragStart={(_e, info) => {
                                            const el = document.querySelector(`[data-card-id="${item.id}"]`);
                                            if (el) {
                                                const rect = el.getBoundingClientRect();
                                                grabOffsetRef.current = {
                                                    x: info.point.x - rect.left,
                                                    y: info.point.y - rect.top,
                                                };
                                            }
                                            handleMotionDragStart(item.id, item.card);
                                        }}
                                        onDrag={(_e, info) => {
                                            if (dragOverlayRef.current) {
                                                dragOverlayRef.current.style.left = `${info.point.x - grabOffsetRef.current.x}px`;
                                                dragOverlayRef.current.style.top = `${info.point.y - grabOffsetRef.current.y}px`;
                                            }
                                        }}
                                        onDragEnd={(e: unknown) => handleMotionDragEnd(item.id, item.card, e)}
                                        style={{
                                            zIndex: draggingCardId === item.id ? 100 : localIdx,
                                            cursor: isMyTurn ? 'grab' : 'default',
                                            opacity: draggingCardId === item.id ? 0 : 1,
                                        }}
                                    >
                                        <div
                                            data-card-id={item.id}
                                            onDoubleClick={() => handleSendToWorkspace(item.id)}
                                            style={{
                                                marginLeft: localIdx === 0 ? '0' : `${handOverlap}px`,
                                                transform: `rotate(${fanAngle}deg) translateY(${fanY}px)`,
                                                transformOrigin: 'bottom center',
                                                transition: 'transform 0.2s ease',
                                            }}
                                        >
                                            <Card
                                                card={item.card}
                                                isDraggable={false}
                                                style={{
                                                    pointerEvents: 'auto',
                                                    ...(comboForCard ? {
                                                        boxShadow: comboForCard.type === 'trio'
                                                            ? '0 0 10px rgba(16, 185, 129, 0.5)'
                                                            : '0 0 10px rgba(99, 102, 241, 0.5)',
                                                        borderTop: `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(99, 102, 241, 0.5)'}`,
                                                        borderBottom: `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(99, 102, 241, 0.5)'}`,
                                                        borderLeft: isComboStart ? `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(99, 102, 241, 0.5)'}` : undefined,
                                                        borderRight: isComboEnd ? `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(99, 102, 241, 0.5)'}` : undefined,
                                                    } : {}),
                                                }}
                                            />
                                        </div>
                                    </Reorder.Item>
                                );
                            })}
                        </Reorder.Group>
                    </div>

                    {/* Workspace + Bajar (right side) */}
                    {(isMyTurn || sortingZoneCards.length > 0) && (
                        <div className="workspace-column">
                            <SortingZone
                                ref={sortingZoneRef}
                                cards={sortingZoneCards}
                                onReturnCard={handleReturnCardToHand}
                                isDropActive={isSortingZoneDropActive}
                                onReorder={handleSortingZoneReorder}
                            />
                            <AnimatePresence>
                                {bajadaReady && (
                                    <motion.button
                                        className="bajar-btn"
                                        onClick={handleBajar}
                                        initial={{ opacity: 0, scale: 0.8, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.8, y: 10 }}
                                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                    >
                                        ¡Bajar!
                                    </motion.button>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </main>

            {/* Drag Overlay */}
            {dragOverlayCard && (
                <div
                    ref={dragOverlayRef}
                    style={{
                        position: 'fixed',
                        left: 0,
                        top: 0,
                        zIndex: 10000,
                        pointerEvents: 'none',
                    }}
                >
                    <Card card={dragOverlayCard} isDraggable={false} style={{ borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
                </div>
            )}
        </div>
    );
}
