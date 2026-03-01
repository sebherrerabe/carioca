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

export function isStandard(card: CardData): card is { Standard: { suit: 'Hearts' | 'Diamonds' | 'Clubs' | 'Spades'; value: string } } {
    return typeof card === 'object' && 'Standard' in card;
}

export function isJoker(card: CardData): card is 'Joker' {
    return card === 'Joker';
}

const VALUE_ORDER: Record<string, number> = {
    'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5, 'Six': 6,
    'Seven': 7, 'Eight': 8, 'Nine': 9, 'Ten': 10,
    'Jack': 11, 'Queen': 12, 'King': 13, 'Ace': 14,
};

export function getValueRank(card: CardData): number | null {
    if (isStandard(card)) return VALUE_ORDER[card.Standard.value] ?? null;
    return null;
}

export function getSuit(card: CardData): string | null {
    if (isStandard(card)) return card.Standard.suit;
    return null;
}

export function getValueName(card: CardData): string | null {
    if (isStandard(card)) return card.Standard.value;
    return null;
}

/**
 * Gets the wrapped rank (2-14) given a starting rank and an offset.
 * e.g. Rank 14 (Ace) + 1 = Rank 2. Rank 2 - 1 = Rank 14 (Ace).
 */
export function getWrappedRank(startRank: number, offset: number): number {
    // Ranks are 2 to 14. Convert to 0-12 range for modulo.
    let zeroBased = startRank - 2;
    // Apply offset and ensure positive result for modulo
    zeroBased = (zeroBased + offset) % 13;
    if (zeroBased < 0) zeroBased += 13;
    // Convert back to 2-14 range
    return zeroBased + 2;
}

/**
 * Checks if a given array of cards represents a descending sequence
 */
export function isDescendingEscala(cards: CardData[]): boolean {
    let firstStdIdx = -1;
    let lastStdIdx = -1;
    for (let i = 0; i < cards.length; i++) {
        if (!isJoker(cards[i])) {
            if (firstStdIdx === -1) firstStdIdx = i;
            lastStdIdx = i;
        }
    }
    if (firstStdIdx !== -1 && lastStdIdx !== -1 && firstStdIdx !== lastStdIdx) {
        const firstRank = getValueRank(cards[firstStdIdx])!;
        const lastRank = getValueRank(cards[lastStdIdx])!;
        return getWrappedRank(firstRank, -(lastStdIdx - firstStdIdx)) === lastRank;
    }
    return false;
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

    // Find the first standard card position
    let firstStdIdx = -1;
    for (let i = 0; i < cards.length; i++) {
        if (!isJoker(cards[i])) { firstStdIdx = i; break; }
    }
    if (firstStdIdx === -1) return false;

    const anchorRank = getValueRank(cards[firstStdIdx])!;

    // Check ascending order sequence
    let isValidAscending = true;
    for (let i = 0; i < cards.length; i++) {
        const expectedRank = getWrappedRank(anchorRank, i - firstStdIdx);
        const card = cards[i];
        if (!isJoker(card) && getValueRank(card) !== expectedRank) {
            isValidAscending = false;
            break;
        }
    }

    // Check descending order sequence
    let isValidDescending = true;
    for (let i = 0; i < cards.length; i++) {
        const expectedRank = getWrappedRank(anchorRank, firstStdIdx - i);
        const card = cards[i];
        if (!isJoker(card) && getValueRank(card) !== expectedRank) {
            isValidDescending = false;
            break;
        }
    }

    return isValidAscending || isValidDescending;
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

    // Check consecutive using anchor approach for both ascending and descending
    let firstStdIdx = -1;
    for (let i = 0; i < cards.length; i++) {
        if (!isJoker(cards[i])) { firstStdIdx = i; break; }
    }
    if (firstStdIdx === -1) return false;

    const anchorRank = getValueRank(cards[firstStdIdx])!;

    let isValidAscending = true;
    for (let i = 0; i < cards.length; i++) {
        const expectedRank = getWrappedRank(anchorRank, i - firstStdIdx);
        const card = cards[i];
        if (!isJoker(card) && getValueRank(card) !== expectedRank) {
            isValidAscending = false;
            break;
        }
    }

    let isValidDescending = true;
    for (let i = 0; i < cards.length; i++) {
        const expectedRank = getWrappedRank(anchorRank, firstStdIdx - i);
        const card = cards[i];
        if (!isJoker(card) && getValueRank(card) !== expectedRank) {
            isValidDescending = false;
            break;
        }
    }

    return isValidAscending || isValidDescending;
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

    // Pass 1: Escalas (>= 4 same-suit cards)
    for (let start = 0; start <= cards.length - 4; start++) {
        if (used.has(start)) continue;

        // Find longest valid length
        let bestLen = 0;
        for (let len = 4; start + len <= cards.length; len++) {
            // Check if any card in this window is used
            let anyUsed = false;
            for (let i = start; i < start + len; i++) {
                if (used.has(i)) { anyUsed = true; break; }
            }
            if (anyUsed) break;

            const window = cards.slice(start, start + len);
            if (isValidEscala(window)) {
                bestLen = len;
            } else {
                break; // Because elements must be continuous ascending, an invalid longer group won't become valid by adding more
            }
        }

        if (bestLen >= 4) {
            combos.push({ type: 'escala', startIndex: start, endIndex: start + bestLen - 1 });
            for (let i = start; i < start + bestLen; i++) used.add(i);
        }
    }

    // Pass 2: Trios (>= 3 same-value cards)
    for (let start = 0; start <= cards.length - 3; start++) {
        if (used.has(start)) continue;

        let bestLen = 0;
        for (let len = 3; start + len <= cards.length; len++) {
            let anyUsed = false;
            for (let i = start; i < start + len; i++) {
                if (used.has(i)) { anyUsed = true; break; }
            }
            if (anyUsed) break;

            const window = cards.slice(start, start + len);
            if (isValidTrio(window)) {
                bestLen = len;
            } else {
                break; // If a longer trio breaks (e.g. different value), adding more won't fix it
            }
        }

        if (bestLen >= 3) {
            combos.push({ type: 'trio', startIndex: start, endIndex: start + bestLen - 1 });
            for (let i = start; i < start + bestLen; i++) used.add(i);
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
