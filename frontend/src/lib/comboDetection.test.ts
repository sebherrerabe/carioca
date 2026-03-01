import { describe, it, expect } from 'vitest';
import {
    isValidTrio,
    isValidEscala,
    isPartialTrio,
    isPartialEscala,
    detectCombos,
    canCardExtendGroup,
    isBajadaComplete,
} from './comboDetection';
import type { CardData } from '../components/Card';

// ─── Helpers ─────────────────────────────────────────────────

const card = (value: string, suit: string): CardData =>
    ({ Standard: { value, suit } }) as CardData;

const joker: CardData = 'Joker';

// ─── isValidTrio ─────────────────────────────────────────────

describe('isValidTrio', () => {
    it('returns true for 3 cards with same value', () => {
        expect(isValidTrio([card('Five', 'Hearts'), card('Five', 'Clubs'), card('Five', 'Spades')])).toBe(true);
    });

    it('returns true for 4 cards with same value', () => {
        expect(isValidTrio([
            card('Ace', 'Hearts'), card('Ace', 'Clubs'),
            card('Ace', 'Spades'), card('Ace', 'Diamonds'),
        ])).toBe(true);
    });

    it('returns true with 1 joker', () => {
        expect(isValidTrio([card('King', 'Hearts'), joker, card('King', 'Spades')])).toBe(true);
    });

    it('returns false with 2 jokers', () => {
        expect(isValidTrio([card('King', 'Hearts'), joker, joker])).toBe(false);
    });

    it('returns false for mixed values', () => {
        expect(isValidTrio([card('Five', 'Hearts'), card('Six', 'Clubs'), card('Five', 'Spades')])).toBe(false);
    });

    it('returns false for fewer than 3 cards', () => {
        expect(isValidTrio([card('Five', 'Hearts'), card('Five', 'Clubs')])).toBe(false);
    });
});

// ─── isPartialTrio ───────────────────────────────────────────

describe('isPartialTrio', () => {
    it('returns true for 2 same-value cards', () => {
        expect(isPartialTrio([card('Seven', 'Hearts'), card('Seven', 'Clubs')])).toBe(true);
    });

    it('returns true for 1 standard + 1 joker', () => {
        expect(isPartialTrio([card('Seven', 'Hearts'), joker])).toBe(true);
    });

    it('returns false for 2 different values', () => {
        expect(isPartialTrio([card('Seven', 'Hearts'), card('Eight', 'Clubs')])).toBe(false);
    });

    it('returns false for 3+ cards', () => {
        expect(isPartialTrio([card('Seven', 'Hearts'), card('Seven', 'Clubs'), card('Seven', 'Spades')])).toBe(false);
    });

    it('returns false for 1 card', () => {
        expect(isPartialTrio([card('Seven', 'Hearts')])).toBe(false);
    });
});

// ─── isValidEscala ───────────────────────────────────────────

describe('isValidEscala', () => {
    it('returns true for 4 consecutive same-suit cards', () => {
        expect(isValidEscala([
            card('Three', 'Hearts'), card('Four', 'Hearts'),
            card('Five', 'Hearts'), card('Six', 'Hearts'),
        ])).toBe(true);
    });

    it('returns true for 5 consecutive same-suit cards', () => {
        expect(isValidEscala([
            card('Seven', 'Spades'), card('Eight', 'Spades'),
            card('Nine', 'Spades'), card('Ten', 'Spades'),
            card('Jack', 'Spades'),
        ])).toBe(true);
    });

    it('returns true with 1 joker filling a gap', () => {
        expect(isValidEscala([
            card('Three', 'Hearts'), card('Four', 'Hearts'),
            joker, card('Six', 'Hearts'),
        ])).toBe(true);
    });

    it('returns false with 2 jokers', () => {
        expect(isValidEscala([
            card('Three', 'Hearts'), joker, joker, card('Six', 'Hearts'),
        ])).toBe(false);
    });

    it('returns false for different suits', () => {
        expect(isValidEscala([
            card('Three', 'Hearts'), card('Four', 'Clubs'),
            card('Five', 'Hearts'), card('Six', 'Hearts'),
        ])).toBe(false);
    });

    it('returns false for non-consecutive values', () => {
        expect(isValidEscala([
            card('Three', 'Hearts'), card('Four', 'Hearts'),
            card('Six', 'Hearts'), card('Seven', 'Hearts'),
        ])).toBe(false);
    });

    it('returns false for fewer than 4 cards', () => {
        expect(isValidEscala([
            card('Three', 'Hearts'), card('Four', 'Hearts'), card('Five', 'Hearts'),
        ])).toBe(false);
    });

    it('returns true with leading joker', () => {
        expect(isValidEscala([
            joker, card('Four', 'Hearts'),
            card('Five', 'Hearts'), card('Six', 'Hearts'),
        ])).toBe(true);
    });

    it('returns true for wrapping from King to Two via Ace', () => {
        expect(isValidEscala([
            card('King', 'Hearts'), card('Ace', 'Hearts'),
            card('Two', 'Hearts'), card('Three', 'Hearts'),
        ])).toBe(true);
    });

    it('returns true for wrapping from Queen to Two via Joker (acting as King)', () => {
        expect(isValidEscala([
            card('Queen', 'Diamonds'), joker,
            card('Ace', 'Diamonds'), card('Two', 'Diamonds'),
        ])).toBe(true);
    });
});

// ─── isPartialEscala ─────────────────────────────────────────

describe('isPartialEscala', () => {
    it('returns true for 2 consecutive same-suit cards', () => {
        expect(isPartialEscala([card('Five', 'Hearts'), card('Six', 'Hearts')])).toBe(true);
    });

    it('returns true for 3 consecutive same-suit cards', () => {
        expect(isPartialEscala([
            card('Five', 'Hearts'), card('Six', 'Hearts'), card('Seven', 'Hearts'),
        ])).toBe(true);
    });

    it('returns false for different suits', () => {
        expect(isPartialEscala([card('Five', 'Hearts'), card('Six', 'Clubs')])).toBe(false);
    });

    it('returns false for 4+ cards', () => {
        expect(isPartialEscala([
            card('Five', 'Hearts'), card('Six', 'Hearts'),
            card('Seven', 'Hearts'), card('Eight', 'Hearts'),
        ])).toBe(false);
    });

    it('returns true for wrapping partial escala', () => {
        expect(isPartialEscala([
            card('King', 'Hearts'), card('Ace', 'Hearts'), card('Two', 'Hearts'),
        ])).toBe(true);
    });
});

// ─── detectCombos ────────────────────────────────────────────

describe('detectCombos', () => {
    it('detects a single trio', () => {
        const cards = [card('Ace', 'Hearts'), card('Ace', 'Clubs'), card('Ace', 'Spades')];
        const combos = detectCombos(cards);
        expect(combos).toHaveLength(1);
        expect(combos[0]).toEqual({ type: 'trio', startIndex: 0, endIndex: 2 });
    });

    it('detects a single escala', () => {
        const cards = [
            card('Three', 'Hearts'), card('Four', 'Hearts'),
            card('Five', 'Hearts'), card('Six', 'Hearts'),
        ];
        const combos = detectCombos(cards);
        expect(combos).toHaveLength(1);
        expect(combos[0]).toEqual({ type: 'escala', startIndex: 0, endIndex: 3 });
    });

    it('detects multiple combos in sequence', () => {
        const cards = [
            // Trio
            card('King', 'Hearts'), card('King', 'Clubs'), card('King', 'Spades'),
            // Escala
            card('Two', 'Diamonds'), card('Three', 'Diamonds'),
            card('Four', 'Diamonds'), card('Five', 'Diamonds'),
        ];
        const combos = detectCombos(cards);
        expect(combos).toHaveLength(2);
        expect(combos[0].type).toBe('trio');
        expect(combos[1].type).toBe('escala');
    });

    it('returns empty for fewer than 3 cards', () => {
        expect(detectCombos([card('Ace', 'Hearts'), card('King', 'Clubs')])).toEqual([]);
    });

    it('returns empty when no valid combos exist', () => {
        const cards = [
            card('Two', 'Hearts'), card('Five', 'Clubs'), card('King', 'Spades'),
        ];
        expect(detectCombos(cards)).toEqual([]);
    });

    it('prefers escalas over trios when overlapping', () => {
        // 4 consecutive same-suit could be an escala (even though 3 could be a trio of different values)
        const cards = [
            card('Three', 'Hearts'), card('Four', 'Hearts'),
            card('Five', 'Hearts'), card('Six', 'Hearts'),
        ];
        const combos = detectCombos(cards);
        expect(combos).toHaveLength(1);
        expect(combos[0].type).toBe('escala');
    });
});

// ─── canCardExtendGroup ──────────────────────────────────────

describe('canCardExtendGroup', () => {
    it('allows extending a partial trio', () => {
        const group = [card('Five', 'Hearts'), card('Five', 'Clubs')];
        expect(canCardExtendGroup(group, card('Five', 'Spades'))).toBe(true);
    });

    it('rejects extending a partial trio with wrong value', () => {
        const group = [card('Five', 'Hearts'), card('Five', 'Clubs')];
        expect(canCardExtendGroup(group, card('Ten', 'Spades'))).toBe(false);
    });

    it('allows extending a partial escala', () => {
        const group = [card('Three', 'Hearts'), card('Four', 'Hearts'), card('Five', 'Hearts')];
        expect(canCardExtendGroup(group, card('Six', 'Hearts'))).toBe(true);
    });

    it('rejects extending escala with wrong suit', () => {
        const group = [card('Three', 'Hearts'), card('Four', 'Hearts'), card('Five', 'Hearts')];
        expect(canCardExtendGroup(group, card('Six', 'Clubs'))).toBe(false);
    });

    it('allows adding a joker to a partial trio', () => {
        const group = [card('Five', 'Hearts')];
        expect(canCardExtendGroup(group, joker)).toBe(true);
    });
});

// ─── isBajadaComplete ────────────────────────────────────────

describe('isBajadaComplete', () => {
    it('returns true when requirements met for 2 trios', () => {
        const combos = [
            { type: 'trio' as const, startIndex: 0, endIndex: 2 },
            { type: 'trio' as const, startIndex: 3, endIndex: 5 },
        ];
        expect(isBajadaComplete(combos, 2, 0)).toBe(true);
    });

    it('returns false when not enough trios', () => {
        const combos = [
            { type: 'trio' as const, startIndex: 0, endIndex: 2 },
        ];
        expect(isBajadaComplete(combos, 2, 0)).toBe(false);
    });

    it('returns true for 1 trio + 1 escala', () => {
        const combos = [
            { type: 'trio' as const, startIndex: 0, endIndex: 2 },
            { type: 'escala' as const, startIndex: 3, endIndex: 6 },
        ];
        expect(isBajadaComplete(combos, 1, 1)).toBe(true);
    });

    it('returns false when escalas missing', () => {
        const combos = [
            { type: 'trio' as const, startIndex: 0, endIndex: 2 },
        ];
        expect(isBajadaComplete(combos, 1, 1)).toBe(false);
    });
});
