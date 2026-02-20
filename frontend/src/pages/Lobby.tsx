import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useWebSocket } from '../lib/WebSocketContext';

export default function Lobby() {
    const [, setLocation] = useLocation();
    const { connect, disconnect, gameState } = useWebSocket();
    const username = localStorage.getItem('username');
    const token = localStorage.getItem('token');

    useEffect(() => {
        if (!token) {
            setLocation('/');
            return;
        }

        // Connect to WebSocket matchmaking
        connect(token);

        // Cleanup on unmount (if they leave the page, disconnect)
        return () => {
            // Disconnect if we leave the lobby AND haven't found a game
            if (!gameState) {
                disconnect();
            }
        };
    }, [token]);

    const handleLogout = () => {
        disconnect();
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        setLocation('/');
    };

    return (
        <div className="auth-container">
            <div className="auth-card" style={{ maxWidth: '600px', display: 'flex', alignItems: 'center' }}>
                <h1 style={{ marginBottom: '1rem' }}>Carioca Lobby</h1>

                <p style={{ fontSize: '1.2rem', margin: '2rem 0' }}>
                    Welcome, <strong>{username}</strong>!
                </p>

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '2rem',
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    borderRadius: 'var(--radius-md)',
                    width: '100%',
                    border: '1px solid var(--color-border)'
                }}>
                    <div className="spinner" style={{
                        width: '40px',
                        height: '40px',
                        border: '4px solid var(--color-primary-main)',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                    }} />
                    <style dangerouslySetInnerHTML={{
                        __html: `
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          `}} />
                    <p>Looking for 4 players to start...</p>
                </div>

                <button onClick={handleLogout} className="btn btn-secondary" style={{ marginTop: '2rem' }}>
                    Cancel & Logout
                </button>
            </div>
        </div>
    );
}
