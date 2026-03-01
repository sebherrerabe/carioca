/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'wouter';
import type { CardData } from '../components/Card';

// Using the same data structures defined in the backend
interface PlayerState {
    id: string;
    hand_count: number;
    has_dropped_hand: boolean;
    points: number;
    dropped_combinations: CardData[][];
    turns_played: number;
    has_drawn_this_turn: boolean;
    dropped_hand_this_turn: boolean;
}

export interface PlayerScore {
    id: string;
    round_points: number;
    total_points: number;
}

export interface RoundEndData {
    round_index: number;
    round_name: string;
    winner_id: string;
    player_scores: PlayerScore[];
    next_round_index: number;
    next_round_name: string;
    is_game_over: boolean;
}

export interface GameState {
    my_hand: CardData[];
    players: PlayerState[];
    current_round_index: number;
    current_round_rules: string;
    current_turn_index: number;
    discard_pile_top: CardData | null;
    is_game_over: boolean;
    required_trios: number;
    required_escalas: number;
}

type ServerMessage =
    | { type: 'MatchFound', payload: { room_id: string, players: string[] } }
    | { type: 'GameStateUpdate', payload: GameState }
    | { type: 'RoundEnded', payload: RoundEndData }
    | { type: 'Error', payload: { message: string } };

interface WebSocketContextType {
    socket: WebSocket | null;
    gameState: GameState | null;
    roundEndData: RoundEndData | null;
    connect: (token: string) => void;
    disconnect: () => void;
    sendAction: (action: unknown) => void;
    error: string | null;
    clearError: () => void;
    clearRoundEndData: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export function WebSocketProvider({ children }: { children: ReactNode }) {
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [gameState, setGameState] = useState<GameState | null>(null);
    const [roundEndData, setRoundEndData] = useState<RoundEndData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [, setLocation] = useLocation();

    const clearError = () => setError(null);
    const clearRoundEndData = () => setRoundEndData(null);

    const connect = (token: string) => {
        if (socket) return;

        const ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);

        ws.onmessage = (event) => {
            try {
                const msg: ServerMessage = JSON.parse(event.data);
                switch (msg.type) {
                    case 'MatchFound':
                        setLocation('/game'); // Redirect automatically to the game board
                        break;
                    case 'GameStateUpdate':
                        console.log("📥 Received GameStateUpdate:", msg.payload);
                        setGameState(msg.payload);
                        break;
                    case 'RoundEnded':
                        console.log("🏆 Received RoundEnded:", msg.payload);
                        setRoundEndData(msg.payload);
                        break;
                    case 'Error':
                        setError(msg.payload.message);
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

    const sendAction = (action: unknown) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            clearError();
            socket.send(JSON.stringify(action));
        }
    };

    return (
        <WebSocketContext.Provider value={{ socket, gameState, roundEndData, connect, disconnect, sendAction, error, clearError, clearRoundEndData }}>
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
