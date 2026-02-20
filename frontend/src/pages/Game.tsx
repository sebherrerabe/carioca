import { useLocation } from 'wouter';
import { useWebSocket } from '../lib/WebSocketContext';
import { Card } from '../components/Card';
import './Game.css';

const BOT_DISPLAY_NAMES: Record<string, string> = {
    'bot_easy': '🤖 Easy Bot',
    'bot_medium': '🧠 Medium Bot',
    'bot_hard': '💀 Hard Bot',
};

function getPlayerDisplayName(id: string): string {
    return BOT_DISPLAY_NAMES[id] || id;
}

export default function Game() {
    const [, setLocation] = useLocation();
    const { gameState, disconnect, sendAction } = useWebSocket();
    const username = localStorage.getItem('username') || '';
    const userId = localStorage.getItem('user_id') || '';

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

    const handleQuit = () => {
        disconnect();
        setLocation('/lobby');
    };

    // Filter away ourselves from the opponents list using the UUID-based user_id
    const opponents = gameState.players.filter(p => p.id !== userId);
    const me = gameState.players.find(p => p.id === userId);
    const isMyTurn = me && gameState.players.indexOf(me) === gameState.current_turn_index;

    return (
        <div className="game-container">
            {/* Header */}
            <header className="game-header">
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>🃏 Carioca</h2>
                <div className="game-header-info">
                    <span className="game-username">{username}</span>
                    <span className="game-badge">Round {gameState.current_round_index + 1}</span>
                    {isMyTurn && <span className="game-badge your-turn">Your Turn!</span>}
                    <button onClick={handleQuit} className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Quit</button>
                </div>
            </header>

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
                                <span className="opponent-card-count">{opp.hand_count} cards</span>
                            </div>
                        );
                    })}
                </div>

                {/* Table Center */}
                <div className="table-center">
                    {/* Draw Deck */}
                    <div className="deck-area" onClick={() => isMyTurn && sendAction({ type: 'DrawFromDeck' })}>
                        <div className="deck-stack">
                            <Card card={{ Standard: { suit: 'Spades', value: 'Ace' } }} faceDown={true}
                                style={{ position: 'absolute', left: 4, top: 4 }} />
                            <Card card={{ Standard: { suit: 'Spades', value: 'Ace' } }} faceDown={true}
                                style={{ position: 'absolute', left: 2, top: 2 }} />
                            <Card card={{ Standard: { suit: 'Spades', value: 'Ace' } }} faceDown={true}
                                style={{ position: 'absolute', left: 0, top: 0 }} />
                        </div>
                        <span className="deck-label">Draw</span>
                    </div>

                    {/* Discard Pile */}
                    <div className="discard-area" onClick={() => isMyTurn && sendAction({ type: 'DrawFromDiscard' })}>
                        <div className="discard-slot">
                            {gameState.discard_pile_top ? (
                                <Card card={gameState.discard_pile_top} />
                            ) : (
                                <span className="discard-empty">Discard</span>
                            )}
                        </div>
                        <span className="deck-label">Discard</span>
                    </div>
                </div>

                {/* My Hand */}
                <div className="my-hand-area">
                    <div className="my-hand">
                        {gameState.my_hand.map((card, idx) => (
                            <Card
                                key={idx}
                                card={card}
                                isDraggable={!!isMyTurn}
                                onClick={() => {
                                    if (isMyTurn && gameState.my_hand.length > 12) {
                                        sendAction({ type: 'Discard', payload: { card_index: idx } });
                                    }
                                }}
                                style={{
                                    zIndex: idx,
                                    marginLeft: idx === 0 ? '0' : '-45px',
                                }}
                            />
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}
