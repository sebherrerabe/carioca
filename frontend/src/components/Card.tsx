import React from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import './Card.css';

// Matches the Rust serde serialization of Card enum:
// Standard variant: {"Standard": {"suit": "Hearts", "value": "Ace"}}
// Joker variant: "Joker"
export type CardData =
    | { Standard: { suit: 'Hearts' | 'Diamonds' | 'Clubs' | 'Spades'; value: string } }
    | 'Joker';

// Helper to check card type
function isStandard(card: CardData): card is { Standard: { suit: 'Hearts' | 'Diamonds' | 'Clubs' | 'Spades'; value: string } } {
    return typeof card === 'object' && 'Standard' in card;
}

interface CardProps {
    card: CardData;
    faceDown?: boolean;
    onClick?: () => void;
    isDraggable?: boolean;
    onDragEnd?: (info: any) => void;
    className?: string;
    style?: React.CSSProperties;
}

const VALUE_MAP: Record<string, string> = {
    'Two': '2', 'Three': '3', 'Four': '4', 'Five': '5', 'Six': '6',
    'Seven': '7', 'Eight': '8', 'Nine': '9', 'Ten': '10',
    'Jack': 'J', 'Queen': 'Q', 'King': 'K', 'Ace': 'A'
};

const SUIT_MAP: Record<string, string> = {
    'Hearts': '♥', 'Diamonds': '♦', 'Clubs': '♣', 'Spades': '♠'
};

export const Card: React.FC<CardProps> = ({
    card,
    faceDown = false,
    onClick,
    isDraggable = false,
    onDragEnd,
    className,
    style
}) => {

    if (faceDown) {
        return (
            <motion.div
                className={clsx('playing-card card-back', className)}
                style={style}
            >
                <div className="card-pattern"></div>
            </motion.div>
        );
    }

    if (card === 'Joker') {
        return (
            <motion.div
                className={clsx('playing-card joker-card', className)}
                style={style}
                onClick={onClick}
                drag={isDraggable}
                dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
                dragElastic={0.2}
                onDragEnd={(_, info) => onDragEnd?.(info)}
                whileHover={isDraggable ? { y: -15, zIndex: 10 } : { scale: 1.05 }}
                whileDrag={{ scale: 1.1, zIndex: 100, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}
            >
                <div className="card-joker-content">
                    <span className="joker-text">JOKER</span>
                    <span className="joker-icon">🃏</span>
                </div>
            </motion.div>
        );
    }

    if (!isStandard(card)) return null;

    const { suit, value } = card.Standard;
    const isRed = suit === 'Hearts' || suit === 'Diamonds';
    const suitSymbol = SUIT_MAP[suit] || '?';
    const displayValue = VALUE_MAP[value] || value;

    return (
        <motion.div
            className={clsx('playing-card', isRed ? 'red-suit' : 'black-suit', className)}
            style={style}
            onClick={onClick}
            drag={isDraggable}
            dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => onDragEnd?.(info)}
            whileHover={isDraggable ? { y: -15, zIndex: 10 } : { scale: 1.05 }}
            whileDrag={{ scale: 1.1, zIndex: 100, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}
        >
            <div className="card-corner top-left">
                <span className="card-value">{displayValue}</span>
                <span className="card-suit">{suitSymbol}</span>
            </div>

            <div className="card-center">
                <span className="card-suit-large">{suitSymbol}</span>
            </div>

            <div className="card-corner bottom-right">
                <span className="card-value">{displayValue}</span>
                <span className="card-suit">{suitSymbol}</span>
            </div>
        </motion.div>
    );
};
