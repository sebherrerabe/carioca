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
    const { gameState, disconnect, sendAction } = useWebSocket();
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
    const hasDrawn = (gameState?.my_hand.length ?? 0) >= 13;
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
        const serverCardsStr = [...gameState.my_hand].map(c => JSON.stringify(c)).sort().join('|');
        const localCardsStr = handCards.map(i => JSON.stringify(i.card)).sort().join('|');
        if (serverCardsStr !== localCardsStr) {
             
            setHandCards(gameState.my_hand.map(card => ({ id: crypto.randomUUID(), card })));
            // Also reset staging
             
            setStagingGroups([]);
             
            setSelectedCardIds([]);
             
            setStagedCardIds([]);
        }
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
        sendAction({ type: 'DropHand', payload: { combinations: combos } });
        setStagingGroups([]);
        setStagedCardIds([]);
    }, [canBajar, stagingGroups, sendAction]);

    // Drag to Pozo to Discard — must be above early return (Rules of Hooks)
    const handleDragStart = (id: string) => setDraggingCardId(id);

    const handleDragEnd = useCallback((_id: string, card: CardData, event: PointerEvent) => {
        setDraggingCardId(null);
        setIsDraggingOverPozo(false);

        if (!pozoRef.current || !isMyTurn || !hasDrawn || !gameState) return;

        const pozoRect = pozoRef.current.getBoundingClientRect();
        const { clientX: x, clientY: y } = event;

        const droppedOnPozo = x >= pozoRect.left && x <= pozoRect.right && y >= pozoRect.top && y <= pozoRect.bottom;
        if (!droppedOnPozo) return;

        const serverIdx = gameState.my_hand.findIndex(c => JSON.stringify(c) === JSON.stringify(card));
        if (serverIdx === -1) return;

        sendAction({ type: 'Discard', payload: { card_index: serverIdx } });
    }, [isMyTurn, hasDrawn, gameState, sendAction]);

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

    // Submit Bajada to backend

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
                            onClick={() => canDraw && sendAction({ type: 'DrawFromDeck' })}
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
                            onClick={() => canDraw && gameState.discard_pile_top && sendAction({ type: 'DrawFromDiscard' })}
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
                                    dragListener={!isMyTurn || canDraw} // allow reorder only when not needing to drag-to-pozo
                                    onDragStart={() => handleDragStart(item.id)}
                                    onDragEnd={(e: unknown) => handleDragEnd(item.id, item.card, e as PointerEvent)}
                                    style={{
                                        zIndex: isSelected ? 100 : localIdx,
                                        marginLeft: localIdx === 0 ? '0' : '-36px',
                                        cursor: (hasDrawn && isMyTurn) ? 'grab' : 'default',
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
