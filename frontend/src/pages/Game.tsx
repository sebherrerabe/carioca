import { useLocation } from 'wouter';
import { useWebSocket } from '../lib/WebSocketContext';

export default function Game() {
    const [, setLocation] = useLocation();
    const { gameState, disconnect } = useWebSocket();
    const username = localStorage.getItem('username');

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

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{ padding: '1rem 2rem', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2>Carioca Game Room</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                    <span style={{ color: 'var(--color-primary-main)' }}>{username}</span>
                    <span>Round: <strong>{gameState.current_round}</strong></span>
                    <span>Turn: Player {gameState.current_turn}</span>
                    <button onClick={handleQuit} className="btn btn-secondary">Quit Match</button>
                </div>
            </header>

            <main style={{ flex: 1, backgroundColor: '#0A4A3C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* 
               TODO: We will build the actual Card layout here using Framer Motion 
               for drag-and-drop mechanics.
            */}
                <h1 style={{ color: 'rgba(255,255,255,0.2)' }}>Board Layout Placeholder</h1>
            </main>
        </div>
    );
}
