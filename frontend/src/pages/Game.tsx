import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Reorder } from 'framer-motion';
import { useWebSocket } from '../lib/WebSocketContext';
import { Card, type CardData } from '../components/Card';
import { SortingZone, type SortingCard } from '../components/SortingZone';
import { detectCombos, isBajadaComplete } from '../lib/comboDetection';
import './Game.css';

const BOT_DISPLAY_NAMES: Record<string, string> = {
    'bot_easy': '🤖 Easy Bot',
    'bot_medium': '🧠 Medium Bot',
    'bot_hard': '💀 Hard Bot',
};

function getPlayerDisplayName(id: string): string {
    if (BOT_DISPLAY_NAMES[id]) return BOT_DISPLAY_NAMES[id];
    // Truncate UUID-style IDs to first 6 chars so they fit the narrow label column
    return id.length > 10 ? id.slice(0, 6) + '…' : id;
}

interface HandCard {
    id: string;
    card: CardData;
}

export default function Game() {
    const [, setLocation] = useLocation();
    const { gameState, disconnect, sendAction, error } = useWebSocket();
    const username = localStorage.getItem('username') || '';

    // Safely decode the user_id
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


    // Local sorted hand for Framer Motion Reorder
    const [handCards, setHandCards] = useState<HandCard[]>([]);

    // Sorting zone cards
    const [sortingZoneCards, setSortingZoneCards] = useState<SortingCard[]>([]);
    const [isSortingZoneDropActive, setIsSortingZoneDropActive] = useState(false);



    // Refs
    const pozoRef = useRef<HTMLDivElement>(null);
    const centralTableRef = useRef<HTMLDivElement>(null);
    const sortingZoneRef = useRef<HTMLDivElement>(null);
    const dragOverlayRef = useRef<HTMLDivElement>(null);
    const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    // ─── Derived State ───────────────────────────────────────
    const me = gameState?.players.find(p => p.id === userId);
    const isMyTurn = gameState ? (me && gameState.players.indexOf(me) === gameState.current_turn_index) : false;
    const totalCards = (gameState?.my_hand.length ?? 0) + (me?.dropped_combinations.reduce((acc, c) => acc + c.length, 0) ?? 0);
    const hasDrawn = totalCards > 12;
    const canDraw = isMyTurn && !hasDrawn;
    const isFirstTurn = (me?.turns_played ?? 0) === 0;
    const canBajar = isMyTurn && hasDrawn && !isFirstTurn && !(me?.has_dropped_hand);
    // Can shed: must be my turn, must have already dropped hand (bajado) AND drawn a card this turn
    // NEW: Cannot shed on the same turn you dropped your hand.
    const canShed = isMyTurn && hasDrawn && (me?.has_dropped_hand === true) && !(me?.dropped_hand_this_turn);

    // Combo detection on sorting zone
    const sortingZoneCombos = useMemo(
        () => detectCombos(sortingZoneCards.map(c => c.card)),
        [sortingZoneCards]
    );

    // Combo detection on hand
    const handCombos = useMemo(
        () => detectCombos(handCards.map(h => h.card)),
        [handCards]
    );

    // Check if bajada is complete (must organize combos entirely in sorting zone to Bajar)
    const bajadaReady = useMemo(() => {
        if (!gameState || !canBajar) return false;

        return isBajadaComplete(
            sortingZoneCombos,
            gameState.required_trios,
            gameState.required_escalas,
        );
    }, [sortingZoneCombos, gameState, canBajar]);

    // Instruction text
    const getInstruction = (): string => {
        if (!isMyTurn) return '';
        if (canDraw) return '📥 Click Mazo or Pozo to pick up a card';
        if (isFirstTurn) return '🃏 First turn — drag a card from your hand onto the Pozo to discard';
        if (canShed) return '🃏 Drop hand — drag cards to combos on the table to shed, or drag to the Pozo to discard';
        if (me?.has_dropped_hand) return '🃏 You have dropped your hand — drag a card to the Pozo to discard';
        if (bajadaReady) return '✅ Bajada ready! Click the "¡Bajar!" button below your sorting zone.';
        return '🃏 Drag cards to the Mesa de trabajo to organize combos, then drag to the Pozo to discard';
    };

    // ─── Sync hand with server ───────────────────────────────

    // We use a ref to hold the current local cards to avoid triggering the sync effect infinitely
    const localCardsRef = useRef<{ hand: HandCard[], sortingZone: SortingCard[] }>({ hand: handCards, sortingZone: sortingZoneCards });
    useEffect(() => {
        localCardsRef.current = { hand: handCards, sortingZone: sortingZoneCards };
    }, [handCards, sortingZoneCards]);

    useEffect(() => {
        if (!gameState) return;

        const serverCards = gameState.my_hand;
        const currentLocal = localCardsRef.current;

        // Fast check: if the total cards match exactly in content and order, do nothing.
        const allLocalCards = [...currentLocal.hand.map(h => h.card), ...currentLocal.sortingZone.map(s => s.card)];
        const serverCardsStr = serverCards.map(c => JSON.stringify(c)).join('|');
        const localCardsStr = allLocalCards.map(c => JSON.stringify(c)).join('|');
        if (serverCardsStr === localCardsStr) return;

        const serverCardsLeft = [...serverCards];
        const newSortingZone: SortingCard[] = [];

        // 1. Keep cards in sorting zone that still exist on server
        for (const existingSz of currentLocal.sortingZone) {
            const matchIndex = serverCardsLeft.findIndex(c => JSON.stringify(c) === JSON.stringify(existingSz.card));
            if (matchIndex !== -1) {
                newSortingZone.push(existingSz);
                serverCardsLeft.splice(matchIndex, 1);
            }
        }

        const newHand: HandCard[] = [];

        // 2. Keep cards in hand that still exist on server
        for (const existingHand of currentLocal.hand) {
            const matchIndex = serverCardsLeft.findIndex(c => JSON.stringify(c) === JSON.stringify(existingHand.card));
            if (matchIndex !== -1) {
                newHand.push(existingHand);
                serverCardsLeft.splice(matchIndex, 1);
            }
        }

        // 3. Any remaining cards from the server are genuinely new (e.g. drawn this turn)
        for (const newCard of serverCardsLeft) {
            newHand.push({ id: crypto.randomUUID(), card: newCard });
        }

        // Only update state if something actually changed (prevents unnecessary re-renders)
        const newSortingZoneStr = newSortingZone.map(c => c.id).join('|');
        const currentSortingZoneStr = currentLocal.sortingZone.map(c => c.id).join('|');
        if (newSortingZoneStr !== currentSortingZoneStr) {
            setSortingZoneCards(newSortingZone);
        }

        const newHandStr = newHand.map(c => c.id).join('|');
        const currentHandStr = currentLocal.hand.map(c => c.id).join('|');
        if (newHandStr !== currentHandStr) {
            setHandCards(newHand);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState?.my_hand]);


    // ─── Bajar Button Handler ────

    const handleBajar = useCallback(() => {
        if (!canBajar || !gameState || !bajadaReady) return;

        const submissionCombos: CardData[][] = [];
        sortingZoneCombos.forEach(combo => {
            submissionCombos.push(sortingZoneCards.slice(combo.startIndex, combo.endIndex + 1).map(sc => sc.card));
        });

        if (submissionCombos.length === 0) return;

        console.log('Submitting Bajada with combos:', submissionCombos);
        sendAction({ type: 'DropHand', payload: { combinations: submissionCombos } });

        // Bug 4 Fix: Only remove cards from sorting zone that were submitted as combos
        const usedSortingIndices = new Set<number>();
        sortingZoneCombos.forEach(c => {
            for (let i = c.startIndex; i <= c.endIndex; i++) usedSortingIndices.add(i);
        });

        const newSortingZone = sortingZoneCards.filter((_, i) => !usedSortingIndices.has(i));
        setSortingZoneCards(newSortingZone);
    }, [canBajar, gameState, bajadaReady, sortingZoneCombos, sortingZoneCards, sendAction]);



    // Drag overlay card (rendered as floating clone)
    const [dragOverlayCard, setDragOverlayCard] = useState<CardData | null>(null);

    // Framer Motion drag start
    const handleMotionDragStart = (id: string, card: CardData) => {
        setDraggingCardId(id);
        setDragOverlayCard(card);
    };

    // Extract pointer coords from any event type
    const getEventCoords = (event: unknown): { x: number; y: number } => {
        const ev = event as { clientX?: number; clientY?: number; touches?: Array<{ clientX: number; clientY: number }>; changedTouches?: Array<{ clientX: number; clientY: number }> };
        if (ev.clientX !== undefined) return { x: ev.clientX, y: ev.clientY! };
        if (ev.touches && ev.touches.length > 0) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
        if (ev.changedTouches && ev.changedTouches.length > 0) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
        return { x: 0, y: 0 };
    };

    const isInsideRect = (x: number, y: number, rect: DOMRect) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

    // Framer Motion drag end — detects drops on Pozo, Sorting Zone, or Central Table
    const handleMotionDragEnd = useCallback((id: string, card: CardData, event: unknown) => {
        setDraggingCardId(null);
        setDragOverlayCard(null);
        setIsDraggingOverPozo(false);
        setIsSortingZoneDropActive(false);

        if (!isMyTurn || !gameState) return;

        const { x, y } = getEventCoords(event);

        // Sorting zone: allowed any time during your turn (even before drawing)
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

        // Actions below require having drawn a card first
        if (!hasDrawn) return;

        // Pozo: discard a card
        if (pozoRef.current) {
            const pozoRect = pozoRef.current.getBoundingClientRect();
            if (isInsideRect(x, y, pozoRect)) {
                const serverIdx = gameState.my_hand.findIndex(c => JSON.stringify(c) === JSON.stringify(card));
                if (serverIdx !== -1) {
                    // Optimistically remove to prevent ReorderHand conflict
                    setHandCards(prev => prev.filter(c => c.id !== id));
                    setSortingZoneCards(prev => prev.filter(c => c.id !== id));
                    sendAction({ type: 'Discard', payload: { card_index: serverIdx } });
                }
                return;
            }
        }

        // Central Table: bajada
        if (centralTableRef.current && canBajar && bajadaReady) {
            const tableRect = centralTableRef.current.getBoundingClientRect();
            if (isInsideRect(x, y, tableRect)) {
                // Drag to table disabled, must use Bajar button
                return;
            }
        }

        // Shed: drop a card onto an existing bajada group
        if (canShed) {
            const elements = document.elementsFromPoint(x, y);
            const shedTarget = elements.find(el => el.hasAttribute('data-shed-player'));
            if (shedTarget) {
                const targetPlayerId = shedTarget.getAttribute('data-shed-player')!;
                const targetComboIdx = parseInt(shedTarget.getAttribute('data-shed-combo')!, 10);
                const handIndex = gameState.my_hand.findIndex(
                    c => JSON.stringify(c) === JSON.stringify(card)
                );
                if (handIndex !== -1) {
                    console.log(`🃏 Shedding card at index ${handIndex} onto ${targetPlayerId} combo ${targetComboIdx}`);
                    // Optimistically remove to prevent ReorderHand conflict
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

    // Persist hand order to server
    useEffect(() => {
        if (!isMyTurn || !gameState || (handCards.length === 0 && sortingZoneCards.length === 0)) return;

        const serverCardsStr = gameState.my_hand.map(c => JSON.stringify(c)).join('|');

        // The fully ordered set of local cards is hand cards FIRST, then sorting zone cards
        // Wait, realistically, if we want dragging to not fight the server, we just persist the concatenated list.
        const allLocalCards = [...handCards.map(h => h.card), ...sortingZoneCards.map(s => s.card)];
        const localCardsStr = allLocalCards.map(c => JSON.stringify(c)).join('|');

        const sameContent = [...gameState.my_hand].map(c => JSON.stringify(c)).sort().join('|') === [...allLocalCards].map(c => JSON.stringify(c)).sort().join('|');

        if (sameContent && serverCardsStr !== localCardsStr && !draggingCardId) {
            sendAction({ type: 'ReorderHand', payload: { hand: allLocalCards } });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handCards, sortingZoneCards, draggingCardId, isMyTurn, gameState?.my_hand, sendAction]);

    // Pointer move for hover detection (Pozo + Sorting Zone + Central Table)
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

    // Hand overlap adapts to card count
    const handOverlap = Math.max(-50, Math.min(-20, -(handCards.length * 3.2)));

    return (
        <div className="game-container" onPointerMove={handlePointerMove}>
            {/* Kebab Menu */}
            <div className="game-menu-container">
                <button className="kebab-btn" onClick={() => setShowMenu(!showMenu)}>⋮</button>
                {showMenu && (
                    <div className="kebab-dropdown">
                        <div className="dropdown-item user-info">👤 <b>{username}</b></div>
                        <div className="dropdown-divider"></div>
                        <div className="dropdown-item round-info">
                            <span style={{ opacity: 0.7 }}>Round {gameState.current_round_index + 1}:</span>
                            <br />
                            <span style={{ fontSize: '0.8rem' }}>{gameState.current_round_rules}</span>
                        </div>
                        <div className="dropdown-divider"></div>
                        <button className="dropdown-item text-btn" onClick={() => { setShowScoreboard(true); setShowMenu(false); }}>🏆 Scoreboard</button>
                        <button className="dropdown-item text-btn" style={{ color: '#ef4444' }} onClick={handleQuit}>🚪 Quit Match</button>
                    </div>
                )}
            </div>

            {/* Server Error Banner */}
            {error && (
                <div style={{ background: '#e11d48', color: 'white', padding: '0.5rem', textAlign: 'center', fontWeight: 'bold' }}>
                    ⚠️ {error}
                </div>
            )}

            {/* Instruction Bar */}
            {isMyTurn && (
                <div className="instruction-bar">
                    <span>{getInstruction()}</span>
                </div>
            )}

            {/* Scoreboard Modal */}
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

            {/* Main Board */}
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
                                            style={{ width: 35, height: 50, marginLeft: i > 0 ? '-15px' : '0' }} />
                                    ))}
                                    {opp.hand_count > 5 && <span className="opponent-extra">+{opp.hand_count - 5}</span>}
                                </div>
                                <span className="opponent-card-count">{opp.hand_count} cards{opp.has_dropped_hand ? ' • bajado ✅' : ''}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Main Table Area */}
                <div className="table-main-area">
                    {/* Left Side: Deck and Discard (Pozo) */}
                    <div className="table-left-side">
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

                        {/* Pozo (Discard) */}
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

                    {/* Central Table — bajadas */}
                    <div
                        ref={centralTableRef}
                        className={`central-table`}
                    >

                        {/* All players' bajadas */}
                        <div className="dropped-bajadas-area">
                            {gameState.players.filter(p => p.has_dropped_hand).map(player => (
                                <div key={player.id} className="player-bajada-row">
                                    <span className="player-bajada-name">{getPlayerDisplayName(player.id)}{player.id === userId ? ' (You)' : ''}</span>
                                    <div className="player-bajada-groups">
                                        {player.dropped_combinations.map((combo, cIdx) => (
                                            <div
                                                key={cIdx}
                                                className={`player-bajada-group ${canShed ? 'shed-available' : ''}`}
                                                data-shed-player={player.id}
                                                data-shed-combo={cIdx}
                                            >
                                                {combo.map((card, idx) => (
                                                    <div key={idx} className="bajada-card-rendered">
                                                        <Card card={card} isDraggable={false}
                                                            style={{ width: 'clamp(46px, 5vw, 68px)', height: 'clamp(64px, 7.5vw, 96px)', fontSize: 'clamp(0.6rem, 0.9vw, 0.85rem)' }} />
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {gameState.players.filter(p => p.has_dropped_hand).length === 0 && (
                                <div className="central-table-empty">
                                    {canBajar
                                        ? 'Organize combos in the Mesa de trabajo, then drag here to Bajar'
                                        : 'No bajadas yet this round'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Bottom Strip: Hand + Sorting Zone */}
                <div className="bottom-strip">
                    {/* Your Turn badge */}
                    <div style={{ textAlign: 'center', marginBottom: '-0.25rem', zIndex: 10, position: 'relative', width: '100%' }}>
                        {isMyTurn && (
                            <span className="game-badge your-turn" style={{ display: 'inline-block', padding: '0.3rem 0.8rem', fontSize: '0.8rem', boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)' }}>
                                ✨ Your Turn
                            </span>
                        )}
                    </div>

                    <div className="bottom-strip-content">
                        {/* My Hand */}
                        <div className="my-hand-area">
                            <Reorder.Group
                                axis="x"
                                values={handCards}
                                onReorder={setHandCards}
                                className="my-hand"
                                style={{
                                    filter: hasDrawn && isMyTurn ? 'drop-shadow(0 0 10px rgba(99, 102, 241, 0.35))' : 'none',
                                    transition: 'filter 0.3s'
                                }}
                            >
                                {handCards.map((item, localIdx) => {
                                    // Check if this card is part of a detected hand combo
                                    const comboForCard = handCombos.find(c => localIdx >= c.startIndex && localIdx <= c.endIndex);
                                    const isComboStart = comboForCard && localIdx === comboForCard.startIndex;
                                    const isComboEnd = comboForCard && localIdx === comboForCard.endIndex;

                                    return (
                                        <Reorder.Item
                                            key={item.id}
                                            value={item}
                                            drag
                                            onDragStart={(_e, info) => {
                                                // Capture grab offset: distance from pointer to card top-left
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
                                                // Make invisible while dragging — the overlay clone is what the user sees
                                                opacity: draggingCardId === item.id ? 0 : 1,
                                            }}
                                        >
                                            <div data-card-id={item.id} style={{ marginLeft: localIdx === 0 ? '0' : `${handOverlap}px` }}>
                                                <Card
                                                    card={item.card}
                                                    isDraggable={false}
                                                    style={{
                                                        pointerEvents: 'auto',
                                                        borderRadius: '8px',
                                                        ...(comboForCard ? {
                                                            boxShadow: comboForCard.type === 'trio'
                                                                ? '0 0 10px rgba(16, 185, 129, 0.5)'
                                                                : '0 0 10px rgba(99, 102, 241, 0.5)',
                                                            borderTop: `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(99, 102, 241, 0.6)'}`,
                                                            borderBottom: `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(99, 102, 241, 0.6)'}`,
                                                            borderLeft: isComboStart ? `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(99, 102, 241, 0.6)'}` : undefined,
                                                            borderRight: isComboEnd ? `2px solid ${comboForCard.type === 'trio' ? 'rgba(16, 185, 129, 0.6)' : 'rgba(99, 102, 241, 0.6)'}` : undefined,
                                                        } : {}),
                                                    }}
                                                />
                                            </div>
                                        </Reorder.Item>
                                    );
                                })}
                            </Reorder.Group>
                        </div>

                        {/* Sorting Zone — always visible when it's your turn or has cards */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', minWidth: 0 }}>
                            {(isMyTurn || sortingZoneCards.length > 0) && (
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <SortingZone
                                        ref={sortingZoneRef}
                                        cards={sortingZoneCards}
                                        onReturnCard={handleReturnCardToHand}
                                        isDropActive={isSortingZoneDropActive}
                                        onReorder={handleSortingZoneReorder}
                                    />
                                </div>
                            )}

                            {/* Bajar Button */}
                            {bajadaReady && (
                                <button className="bajar-btn" onClick={handleBajar}>
                                    ¡Bajar!
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* Drag Overlay — floating card clone that follows cursor */}
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
                    <Card card={dragOverlayCard} isDraggable={false} style={{ borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
                </div>
            )}
        </div>
    );
}
