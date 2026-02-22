import type { CardData } from '../components/Card';

// ─── Types ───────────────────────────────────────────────────

export type ComboType = 'trio' | 'escala';

export interface DetectedCombo {
    type: ComboType;
    /** Start index in the card array (inclusive) */
    startIndex: number;
    /** End index in the card array (inclusive) */
    endIndex: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function isStandard(card: CardData): card is { Standard: { suit: 'Hearts' | 'Diamonds' | 'Clubs' | 'Spades'; value: string } } {
    return typeof card === 'object' && 'Standard' in card;
}

function isJoker(card: CardData): card is 'Joker' {
    return card === 'Joker';
}

const VALUE_ORDER: Record<string, number> = {
    'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5, 'Six': 6,
    'Seven': 7, 'Eight': 8, 'Nine': 9, 'Ten': 10,
    'Jack': 11, 'Queen': 12, 'King': 13, 'Ace': 14,
};

function getValueRank(card: CardData): number | null {
    if (isStandard(card)) return VALUE_ORDER[card.Standard.value] ?? null;
    return null;
}

function getSuit(card: CardData): string | null {
    if (isStandard(card)) return card.Standard.suit;
    return null;
}

function getValueName(card: CardData): string | null {
    if (isStandard(card)) return card.Standard.value;
    return null;
}

// ─── Trio Detection ──────────────────────────────────────────

/**
 * Checks if a set of cards forms a valid trio:
 * - 3+ cards with the same value
 * - Max 1 joker
 * - At least 1 standard card to define the value
 */
export function isValidTrio(cards: CardData[]): boolean {
    if (cards.length < 3) return false;

    let jokerCount = 0;
    let targetValue: string | null = null;

    for (const card of cards) {
        if (isJoker(card)) {
            jokerCount++;
        } else if (isStandard(card)) {
            if (targetValue === null) {
                targetValue = card.Standard.value;
            } else if (card.Standard.value !== targetValue) {
                return false;
            }
        }
    }

    return jokerCount <= 1 && targetValue !== null;
}

/**
 * Checks if cards could become a valid trio with more cards added.
 * 2 same-value cards = partial trio. Also valid: 1 standard + 1 joker same direction.
 */
export function isPartialTrio(cards: CardData[]): boolean {
    if (cards.length < 2 || cards.length >= 3) return false;

    let jokerCount = 0;
    let targetValue: string | null = null;

    for (const card of cards) {
        if (isJoker(card)) {
            jokerCount++;
        } else if (isStandard(card)) {
            if (targetValue === null) {
                targetValue = card.Standard.value;
            } else if (card.Standard.value !== targetValue) {
                return false;
            }
        }
    }

    return jokerCount <= 1 && targetValue !== null;
}

// ─── Escala Detection ────────────────────────────────────────

/**
 * Checks if a set of cards forms a valid escala:
 * - 4+ consecutive cards of the same suit
 * - Max 1 joker (fills a gap)
 * - Cards must be in ascending order by value
 */
export function isValidEscala(cards: CardData[]): boolean {
    if (cards.length < 4) return false;

    let jokerCount = 0;
    const standardCards: { rank: number; suit: string }[] = [];

    for (const card of cards) {
        if (isJoker(card)) {
            jokerCount++;
        } else if (isStandard(card)) {
            const rank = getValueRank(card);
            const suit = getSuit(card);
            if (rank === null || suit === null) return false;
            standardCards.push({ rank, suit });
        }
    }

    if (jokerCount > 1 || standardCards.length === 0) return false;

    // All standard cards must share the same suit
    const targetSuit = standardCards[0].suit;
    if (!standardCards.every(c => c.suit === targetSuit)) return false;

    // Use the anchoring approach: find the first standard card position,
    // then verify the sequence using in-order traversal
    let firstStdIdx = -1;
    for (let i = 0; i < cards.length; i++) {
        if (!isJoker(cards[i])) { firstStdIdx = i; break; }
    }
    if (firstStdIdx === -1) return false;

    const anchorRank = getValueRank(cards[firstStdIdx])!;
    const startRank = anchorRank - firstStdIdx;

    for (let i = 0; i < cards.length; i++) {
        const expectedRank = startRank + i;
        if (expectedRank < 2 || expectedRank > 14) return false;

        const card = cards[i];
        if (isJoker(card)) continue; // joker fills this slot

        const rank = getValueRank(card);
        if (rank !== expectedRank) return false;
    }

    return true;
}

/**
 * Checks if cards could become a valid escala with more cards.
 * 2-3 consecutive same-suit cards = partial escala.
 */
export function isPartialEscala(cards: CardData[]): boolean {
    if (cards.length < 2 || cards.length >= 4) return false;

    let jokerCount = 0;
    const standardCards: { rank: number; suit: string }[] = [];

    for (const card of cards) {
        if (isJoker(card)) {
            jokerCount++;
        } else if (isStandard(card)) {
            const rank = getValueRank(card);
            const suit = getSuit(card);
            if (rank === null || suit === null) return false;
            standardCards.push({ rank, suit });
        }
    }

    if (jokerCount > 1 || standardCards.length === 0) return false;

    const targetSuit = standardCards[0].suit;
    if (!standardCards.every(c => c.suit === targetSuit)) return false;

    // Check consecutive using anchor approach
    let firstStdIdx = -1;
    for (let i = 0; i < cards.length; i++) {
        if (!isJoker(cards[i])) { firstStdIdx = i; break; }
    }
    if (firstStdIdx === -1) return false;

    const anchorRank = getValueRank(cards[firstStdIdx])!;
    const startRank = anchorRank - firstStdIdx;

    for (let i = 0; i < cards.length; i++) {
        const expectedRank = startRank + i;
        if (expectedRank < 2 || expectedRank > 14) return false;

        const card = cards[i];
        if (isJoker(card)) continue;

        const rank = getValueRank(card);
        if (rank !== expectedRank) return false;
    }

    return true;
}

// ─── Combo Scanning ──────────────────────────────────────────

/**
 * Scans a linear array of cards and detects all maximal adjacent groups
 * that form valid trios or escalas. Priority: longer combos first.
 * Non-overlapping: once a card is part of a combo, it's not re-used.
 */
export function detectCombos(cards: CardData[]): DetectedCombo[] {
    if (cards.length < 3) return [];

    const combos: DetectedCombo[] = [];
    const used = new Set<number>();

    // Strategy: detect exact-size combos for bajada (trios=3, escalas=4)
    // Pass 1: Escalas (exactly 4 consecutive same-suit cards)
    for (let start = 0; start <= cards.length - 4; start++) {
        let anyUsed = false;
        for (let i = start; i < start + 4; i++) {
            if (used.has(i)) { anyUsed = true; break; }
        }
        if (anyUsed) continue;

        const window = cards.slice(start, start + 4);
        if (isValidEscala(window)) {
            combos.push({ type: 'escala', startIndex: start, endIndex: start + 3 });
            for (let i = start; i < start + 4; i++) used.add(i);
        }
    }

    // Pass 2: Trios (exactly 3 same-value cards)
    for (let start = 0; start <= cards.length - 3; start++) {
        let anyUsed = false;
        for (let i = start; i < start + 3; i++) {
            if (used.has(i)) { anyUsed = true; break; }
        }
        if (anyUsed) continue;

        const window = cards.slice(start, start + 3);
        if (isValidTrio(window)) {
            combos.push({ type: 'trio', startIndex: start, endIndex: start + 2 });
            for (let i = start; i < start + 3; i++) used.add(i);
        }
    }

    // Sort by startIndex for consistent ordering
    combos.sort((a, b) => a.startIndex - b.startIndex);
    return combos;
}

// ─── Drop Validation ─────────────────────────────────────────

/**
 * Checks if adding `card` to `existingCards` (at the end) would still
 * be on track toward forming a valid trio or escala.
 * Used to reject invalid drops.
 */
export function canCardExtendGroup(existingCards: CardData[], card: CardData): boolean {
    const extended = [...existingCards, card];

    // If extended forms a valid combo, obviously fine
    if (isValidTrio(extended) || isValidEscala(extended)) return true;

    // If extended is a partial combo (could become valid with more cards), also fine
    if (isPartialTrio(extended) || isPartialEscala(extended)) return true;

    return false;
}

/**
 * Given round requirements, checks if the detected combos satisfy them.
 */
export function isBajadaComplete(
    combos: DetectedCombo[],
    requiredTrios: number,
    requiredEscalas: number,
): boolean {
    const trioCount = combos.filter(c => c.type === 'trio').length;
    const escalaCount = combos.filter(c => c.type === 'escala').length;
    return trioCount >= requiredTrios && escalaCount >= requiredEscalas;
}

// Re-export helpers for tests
export { getValueRank, getSuit, getValueName, isStandard, isJoker };
