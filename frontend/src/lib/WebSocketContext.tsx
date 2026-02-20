import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';

// Using the same data structures defined in the backend
interface PlayerState {
    id: string;
    hand: any[];
    has_drawn: boolean;
    has_dropped_hand: boolean;
    games_won: number;
}

interface GameState {
    players: PlayerState[];
    current_round: string;
    round_index: number;
    current_turn: number;
    deck_size: number;
    discard_pile: any[];
    is_game_over: boolean;
}

type ServerMessage =
    | { type: 'GameStart', state: GameState }
    | { type: 'StateUpdate', state: GameState }
    | { type: 'Error', message: string };

interface WebSocketContextType {
    socket: WebSocket | null;
    gameState: GameState | null;
    connect: (token: string) => void;
    disconnect: () => void;
    sendAction: (action: any) => void;
    error: string | null;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function WebSocketProvider({ children }: { children: ReactNode }) {
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [, setLocation] = useLocation();

    const connect = (token: string) => {
        if (socket) return;

        const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

        ws.onmessage = (event) => {
            try {
                const msg: ServerMessage = JSON.parse(event.data);
                switch (msg.type) {
                    case 'GameStart':
                        setGameState(msg.state);
                        setLocation('/game'); // Redirect automatically to the game board
                        break;
                    case 'StateUpdate':
                        setGameState(msg.state);
                        break;
                    case 'Error':
                        setError(msg.message);
                        break;
                }
            } catch (err) {
                console.error("Failed to parse websocket message", err);
            }
        };

        ws.onclose = () => {
            setSocket(null);
        };

        setSocket(ws);
    };

    const disconnect = () => {
        if (socket) {
            socket.close();
            setSocket(null);
            setGameState(null);
        }
    };

    const sendAction = (action: any) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(action));
        }
    };

    return (
        <WebSocketContext.Provider value={{ socket, gameState, connect, disconnect, sendAction, error }}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function useWebSocket() {
    const context = useContext(WebSocketContext);
    if (context === undefined) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
}
