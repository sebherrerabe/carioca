import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Reorder, motion } from 'framer-motion';
import { useWebSocket } from '../lib/WebSocketContext';
import { Card, type CardData } from '../components/Card';
import './Game.css';

const BOT_DISPLAY_NAMES: Record<string, string> = {
    'bot_easy': '🤖 Easy Bot',
    'bot_medium': '🧠 Medium Bot',
    'bot_hard': '💀 Hard Bot',
};

function getPlayerDisplayName(id: string): string {
    return BOT_DISPLAY_NAMES[id] || id;
}

type TurnPhase = 'draw' | 'staging' | 'discard-only';

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

    // --- Staging area state ---
    // Cards in the staging area, grouped into combinations
    const [stagingGroups, setStagingGroups] = useState<{ id: string; cards: { id: string; card: CardData }[] }[]>([]);
    // Currently selected cards in hand (for staging)
    const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
    // Which handCard IDs are already moved to staging
    const [stagedCardIds, setStagedCardIds] = useState<string[]>([]);

    // UI state
    const [showScoreboard, setShowScoreboard] = useState(false);
    const [isDraggingOverPozo, setIsDraggingOverPozo] = useState(false);
    const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

    // Local sorted hand for Framer Motion Reorder
    const [handCards, setHandCards] = useState<{ id: string; card: CardData }[]>([]);

    // Ref for the Pozo (discard) area to detect drops
    const pozoRef = useRef<HTMLDivElement>(null);

    // Derived state
    const me = gameState?.players.find(p => p.id === userId);
    const isMyTurn = gameState ? (me && gameState.players.indexOf(me) === gameState.current_turn_index) : false;

    // In Carioca, you draw one card at the start of your turn. So if your hand size > base hand size for the round, you have drawn.
    // For MVP, backend deals 12 cards explicitly. So base hand size before drawing is always 12.
    // However, if the player 'baja' (drops hand), their hand size drops.
    // The most robust way to check if we have drawn is to see if we have discarded yet this turn.
    // Wait, the backend tracks `turns_played`. If we haven't discarded in this turn, we are still "in" the turn.
    // Let's use `hand.length` for now based on the fact that if it's > 12, we've drawn. Wait, what if we 'bajamos'?
    // Let's just trust that `hasDrawn` means "have we picked up a card yet". 
    // Wait, if hand is 12, `hasDrawn` is false. If 13, `hasDrawn` is true.
    // If bajado, we definitely have drawn.
    const hasDrawn = (gameState?.my_hand.length ?? 0) > 12 || (me?.has_dropped_hand ?? false);
    const canDraw = isMyTurn && !hasDrawn;
    const isFirstTurn = (me?.turns_played ?? 0) === 0;
    const canBajar = isMyTurn && hasDrawn && !isFirstTurn && !(me?.has_dropped_hand);

    // Turn phase
    const turnPhase: TurnPhase = !isMyTurn ? 'draw'
        : canDraw ? 'draw'
            : isFirstTurn ? 'discard-only'
                : 'staging';

    // Step-by-step instruction for the player
    const getInstruction = (): string => {
        if (!isMyTurn) return '';
        if (turnPhase === 'draw') return '📥 Click Mazo or Pozo to pick up a card';
        if (turnPhase === 'discard-only') return '🃏 First turn — drag a card from your hand onto the Pozo to discard';
        if (me?.has_dropped_hand) return '🃏 You have dropped your hand — drag a card from your hand onto the Pozo to discard';
        return '🃏 Click cards to select them → add to staging to prepare your Bajada, then drag a card to the Pozo';
    };

    // Sync local hand with server state (reset when server hand changes e.g. draw/discard)
    useEffect(() => {
        if (!gameState) return;

        setHandCards(prevItems => {
            // Create a pool of server cards left to map
            const serverCardsLeft = [...gameState.my_hand];
            const newItems: { id: string, card: CardData }[] = [];

            // 1. Keep cards that are still in our hand, maintaining their current order
            for (const existingItem of prevItems) {
                const matchIndex = serverCardsLeft.findIndex(c => JSON.stringify(c) === JSON.stringify(existingItem.card));
                if (matchIndex !== -1) {
                    newItems.push(existingItem);
                    serverCardsLeft.splice(matchIndex, 1);
                }
            }

            // 2. Add any completely new cards drawn this turn to the end of the hand
            for (const newCard of serverCardsLeft) {
                newItems.push({ id: crypto.randomUUID(), card: newCard });
            }

            // Re-check if the actual contents changed (just as an optimization to avoid unneeded re-renders/staging resets)
            const serverCardsStr = [...gameState.my_hand].map(c => JSON.stringify(c)).sort().join('|');
            const localCardsStr = prevItems.map(i => JSON.stringify(i.card)).sort().join('|');

            if (serverCardsStr !== localCardsStr) {
                // The actual cards changed, if a card was removed (discarded) we should clean up staging
                const currentIds = newItems.map(i => i.id);
                setStagingGroups(prev => prev.map(g => ({ ...g, cards: g.cards.filter(c => currentIds.includes(c.id)) })).filter(g => g.cards.length > 0));
                setSelectedCardIds(prev => prev.filter(id => currentIds.includes(id)));
                setStagedCardIds(prev => prev.filter(id => currentIds.includes(id)));
                return newItems;
            }

            return prevItems;
        });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameState?.my_hand]);

    // Reset selection / staging when turn ends
    useEffect(() => {
        if (!isMyTurn) {
            setSelectedCardIds([]);
            setStagingGroups([]);
            setStagedCardIds([]);
        }
    }, [isMyTurn]);

    // Submit Bajada to backend — must be above early return (Rules of Hooks)
    const handleSubmitBajada = useCallback(() => {
        if (!canBajar || stagingGroups.length === 0) return;

        const combos = stagingGroups.map(g => g.cards.map(c => c.card));
        console.log("Submitting Bajada with combos:", combos);

        sendAction({ type: 'DropHand', payload: { combinations: combos } });

        // Clear staging area optimistically
        setStagingGroups([]);
        setStagedCardIds([]);
        setSelectedCardIds([]);
    }, [canBajar, stagingGroups, sendAction]);

    // Drag to Pozo to Discard — must be above early return (Rules of Hooks)
    const handleDragStart = (id: string) => setDraggingCardId(id);

    const handleDragEnd = useCallback((_id: string, card: CardData, event: any) => {
        setDraggingCardId(null);
        setIsDraggingOverPozo(false);

        console.log("Drag ended over Pozo? Checking hit detection.");
        if (!pozoRef.current || !isMyTurn || !hasDrawn || !gameState) {
            console.log("Drag drop rejected. Missing refs or not my turn/hasn't drawn yet");
            return;
        }

        const pozoRect = pozoRef.current.getBoundingClientRect();

        // Safely extract coordinates for both Mouse and Touch events (Framer Motion passes raw events)
        let x = 0;
        let y = 0;
        if (event.clientX !== undefined) {
            x = event.clientX;
            y = event.clientY;
        } else if (event.touches && event.touches.length > 0) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;
        } else if (event.changedTouches && event.changedTouches.length > 0) {
            x = event.changedTouches[0].clientX;
            y = event.changedTouches[0].clientY;
        }

        const droppedOnPozo = x >= pozoRect.left && x <= pozoRect.right && y >= pozoRect.top && y <= pozoRect.bottom;
        console.log(`Drop coords: (${x}, ${y}), Pozo rect:`, pozoRect, "Dropped on Pozo:", droppedOnPozo);
        if (!droppedOnPozo) return;

        const serverIdx = gameState.my_hand.findIndex(c => JSON.stringify(c) === JSON.stringify(card));
        if (serverIdx === -1) {
            console.log("Card not found in server hand");
            return;
        }

        console.log("Sending Action: Discard at index", serverIdx);
        sendAction({ type: 'Discard', payload: { card_index: serverIdx } });
    }, [isMyTurn, hasDrawn, gameState, sendAction]);

    // Send the new hand order to the server to persist it.
    // Framer Motion's onReorder fires multiple times during drag, updating `handCards`.
    // When the drag actually ends, `handCards` has the final order.
    useEffect(() => {
        if (!isMyTurn || !gameState || handCards.length === 0) return;

        // We only want to send this if the order actually changed from the server's perspective, 
        // to avoid spamming identical state updates.
        const serverCardsStr = gameState.my_hand.map(c => JSON.stringify(c)).join('|');
        const localCardsStr = handCards.map(i => JSON.stringify(i.card)).join('|');
        const sameContent = [...gameState.my_hand].map(c => JSON.stringify(c)).sort().join('|') === [...handCards].map(i => JSON.stringify(i.card)).sort().join('|');

        // Only send if the contents are identical (no missing cards from discard) but the order is different.
        if (sameContent && serverCardsStr !== localCardsStr && !draggingCardId) {
            console.log("Sending Action: ReorderHand");
            sendAction({ type: 'ReorderHand', payload: { hand: handCards.map(c => c.card) } });
        }
    }, [handCards, draggingCardId, isMyTurn, gameState, sendAction]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!draggingCardId || !pozoRef.current) return;
        const rect = pozoRef.current.getBoundingClientRect();
        const over = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        setIsDraggingOverPozo(over);
    }, [draggingCardId]);


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

    // --- Card selection (for staging) ---
    const handleCardClick = (id: string) => {
        if (!isMyTurn || turnPhase !== 'staging') return;
        if (stagedCardIds.includes(id)) return; // already in staging
        if (selectedCardIds.includes(id)) {
            setSelectedCardIds(prev => prev.filter(i => i !== id));
        } else {
            setSelectedCardIds(prev => [...prev, id]);
        }
    };

    // Move selected cards into a new staging group
    const handleAddToStaging = () => {
        if (selectedCardIds.length < 3) return;
        const newGroup = {
            id: crypto.randomUUID(),
            cards: selectedCardIds.map(sid => handCards.find(hc => hc.id === sid)!),
        };
        setStagingGroups(prev => [...prev, newGroup]);
        setStagedCardIds(prev => [...prev, ...selectedCardIds]);
        setSelectedCardIds([]);
    };

    // Remove a staging group (put cards back in hand visually – they never left the hand in server state)
    const handleRemoveStagingGroup = (groupId: string) => {
        const group = stagingGroups.find(g => g.id === groupId);
        if (!group) return;
        setStagingGroups(prev => prev.filter(g => g.id !== groupId));
        setStagedCardIds(prev => prev.filter(id => !group.cards.map(c => c.id).includes(id)));
    };

    // Submit Bajada to backend (handled by useCallback earlier to respect hooks rules)
    return (
        <div className="game-container" onPointerMove={handlePointerMove}>
            {/* Header */}
            <header className="game-header">
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>🃏 Carioca</h2>
                <div className="game-header-info">
                    <span className="game-username">{username}</span>
                    <div className="rules-banner">
                        <span style={{ opacity: 0.7 }}>Round {gameState.current_round_index + 1}:</span>
                        <span>{gameState.current_round_rules}</span>
                    </div>
                    <button onClick={() => setShowScoreboard(true)} className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Scoreboard</button>
                    <button onClick={handleQuit} className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Quit</button>
                </div>
            </header>

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
                                <tr>
                                    <th>Player</th>
                                    <th>Points</th>
                                    <th>Status</th>
                                </tr>
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
                                console.log("Mazo clicked. canDraw:", canDraw);
                                if (canDraw) {
                                    console.log("Sending Action: DrawFromDeck");
                                    sendAction({ type: 'DrawFromDeck', payload: null });
                                }
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

                        {/* Pozo (Discard) — also a drop target */}
                        <div
                            ref={pozoRef}
                            className={`discard-area ${canDraw && gameState.discard_pile_top ? 'highlight-action' : ''} ${isDraggingOverPozo ? 'droppable-active' : ''}`}
                            onClick={() => {
                                console.log("Pozo clicked. canDraw:", canDraw, "pile top:", gameState.discard_pile_top);
                                if (canDraw && gameState.discard_pile_top) {
                                    console.log("Sending Action: DrawFromDiscard");
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

                    {/* Right Side: Staging Panel + Opponents' Bajadas */}
                    <div className="table-right-side">
                        {/* Staging Panel — only visible on my turn in staging phase */}
                        {turnPhase === 'staging' && (
                            <div className="staging-panel">
                                <div className="staging-panel-header">
                                    <span>🃏 Bajada Staging</span>
                                    <span className="staging-hint">{gameState.current_round_rules}</span>
                                </div>

                                {/* Combination slots */}
                                <div className="staging-groups">
                                    {stagingGroups.length === 0 && (
                                        <div className="staging-empty">
                                            Select 3+ cards in your hand, then click "Add Combo"
                                        </div>
                                    )}
                                    {stagingGroups.map((group) => (
                                        <div key={group.id} className="staging-group">
                                            <div className="staging-group-cards">
                                                {group.cards.map(item => (
                                                    <div key={item.id} className="staging-card-mini">
                                                        {item.card === 'Joker'
                                                            ? '🤡'
                                                            : `${(item.card as { Standard: { value: string; suit: string } }).Standard.value.slice(0, 2)} ${(item.card as { Standard: { value: string; suit: string } }).Standard.suit.charAt(0)}`}
                                                    </div>
                                                ))}
                                            </div>
                                            <button
                                                className="staging-remove-btn"
                                                onClick={() => handleRemoveStagingGroup(group.id)}
                                                title="Remove this combination"
                                            >✕</button>
                                        </div>
                                    ))}
                                </div>

                                {/* Staging actions */}
                                <div className="staging-actions">
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={handleAddToStaging}
                                        disabled={selectedCardIds.length < 3}
                                    >
                                        Add Combo ({selectedCardIds.length} selected)
                                    </button>
                                    {canBajar && stagingGroups.length > 0 && (
                                        <motion.button
                                            className="btn btn-primary btn-sm"
                                            onClick={handleSubmitBajada}
                                            animate={{ scale: [1, 1.05, 1] }}
                                            transition={{ repeat: Infinity, duration: 2 }}
                                        >
                                            ✅ Bajarme
                                        </motion.button>
                                    )}
                                    {!canBajar && isFirstTurn && (
                                        <span className="staging-locked-label">🔒 Bajada blocked (first turn)</span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Opponents' dropped bajadas */}
                        <div className="dropped-bajadas-area">
                            {gameState.players.filter(p => p.has_dropped_hand).map(player => (
                                <div key={player.id} className="player-bajada-row">
                                    <span className="player-bajada-name">{getPlayerDisplayName(player.id)}'s Bajada</span>
                                    <div className="player-bajada-groups">
                                        {player.dropped_combinations.map((combo, cIdx) => (
                                            <div key={cIdx} className="player-bajada-group">
                                                {combo.map((card, idx) => (
                                                    <div key={idx} className="bajada-card-rendered">
                                                        <Card card={card} isDraggable={false}
                                                            style={{ transform: 'scale(0.55)', transformOrigin: 'top left', margin: '-12px -28px -32px 0' }} />
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* My Hand */}
                <div style={{ textAlign: 'center', marginBottom: '-0.5rem', zIndex: 10, position: 'relative' }}>
                    {isMyTurn && (
                        <span className="game-badge your-turn" style={{ display: 'inline-block', padding: '0.4rem 1rem', fontSize: '0.9rem', boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)' }}>
                            ✨ Your Turn
                        </span>
                    )}
                </div>
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
                            const isStaged = stagedCardIds.includes(item.id);
                            const isSelected = selectedCardIds.includes(item.id);

                            // Dim staged cards but keep them visible in hand
                            return (
                                <Reorder.Item
                                    key={item.id}
                                    value={item}
                                    drag
                                    onDragStart={() => handleDragStart(item.id)}
                                    onDragEnd={(e: unknown) => handleDragEnd(item.id, item.card, e as PointerEvent)}
                                    style={{
                                        zIndex: isSelected ? 100 : localIdx,
                                        marginLeft: localIdx === 0 ? '0' : '-36px',
                                        cursor: isMyTurn ? 'grab' : 'default',
                                        transform: isSelected ? 'translateY(-20px)' : 'none',
                                        opacity: isStaged ? 0.4 : 1,
                                        pointerEvents: isStaged ? 'none' : 'auto',
                                    }}
                                >
                                    <div style={{ pointerEvents: 'none' }}>
                                        <Card
                                            card={item.card}
                                            isDraggable={false}
                                            onClick={() => handleCardClick(item.id)}
                                            style={{
                                                boxShadow: isSelected ? '0 0 15px var(--color-primary-main)' : undefined,
                                                pointerEvents: 'auto',
                                                outline: isSelected ? '2px solid var(--color-primary-main)' : undefined,
                                                borderRadius: '8px',
                                            }}
                                        />
                                    </div>
                                </Reorder.Item>
                            );
                        })}
                    </Reorder.Group>
                </div>
            </main>
        </div>
    );
}
