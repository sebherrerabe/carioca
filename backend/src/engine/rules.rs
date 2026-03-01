use crate::engine::card::{Card, Value};
// use std::collections::{HashMap, HashSet};

/// Represents a set of cards attempting to be played as a 'Trío'
pub fn is_valid_trio(cards: &[Card]) -> bool {
    if cards.len() < 3 {
        return false; // Trio must be at least 3 cards
    }

    let mut jokers = 0;
    let mut standard_value: Option<Value> = None;

    for card in cards {
        match card {
            Card::Joker => {
                jokers += 1;
            }
            Card::Standard { value, .. } => {
                if let Some(v) = standard_value {
                    if v != *value {
                        return false; // All standard cards must have the same value
                    }
                } else {
                    standard_value = Some(*value);
                }
            }
        }
    }

    // A valid trio can have at most 1 joker according to general rules,
    // though some variations say 2 jokers in a hand but max 1 per group.
    // We enforce max 1 joker per combination here based on rules: "solo está permitido el uso de un comodín al bajarse"
    jokers <= 1 && standard_value.is_some()
}

/// Represents a set of cards attempting to be played as an 'Escala'
pub fn is_valid_escala(cards: &[Card]) -> bool {
    if cards.len() < 4 {
        return false; // Escala must be at least 4 cards
    }

    let mut jokers = 0;

    // We need to count jokers and separate standard cards
    let mut standard_cards = Vec::new();
    for card in cards {
        match card {
            Card::Joker => jokers += 1,
            Card::Standard { suit, value } => standard_cards.push((*value, *suit)),
        }
    }

    if jokers > 1 {
        return false; // Only 1 joker allowed per combination
    }

    if standard_cards.is_empty() {
        return false;
    }

    // Check if all cards share the same suit (simplest case first. Rules say "misma o distinta pinta" for normal escalas??
    // Actually, rules say: "una escala de 4 cartas consecutivas de la misma o distinta pinta".
    // "donde si se puede haber 2 escalas de la misma pinta".
    // Wait, let's look at the standard rules again: typically Escalas are same suit. But the text says: "misma o distinta pinta".
    // For now, let's assume standard rummy runs (consecutive, same suit OR we allow mixed suits? "misma o distinta pinta" usually means
    // it can be mixed suits in some Chilean regions. Let's implement the strict consecutive values first).

    // Let's sort the standard cards by value to check for consecutiveness.
    // Handling the "Ace can wrap around" (2-A-K-Q) is complex.
    // For MVP, we'll just check if they can form a consecutive sequence with the available jokers.

    let mut values: Vec<u8> = standard_cards
        .iter()
        .map(|(v, _)| {
            let v_u8 = *v as u8;
            if v_u8 == 14 { 1 } else { v_u8 }
        })
        .collect();
    values.sort_unstable();

    // Check for duplicates
    for i in 0..values.len().saturating_sub(1) {
        if values[i] == values[i + 1] {
            return false; // Duplicates not allowed in escala
        }
    }

    // Modular sequence gap check to support wrap around (e.g. K-A-2)
    let mut max_gap = 0;
    for i in 0..values.len() {
        let v1 = values[i];
        let v2 = values[(i + 1) % values.len()];
        let gap = if i == values.len() - 1 {
            v2 + 13 - v1
        } else {
            v2 - v1
        };
        if gap > max_gap {
            max_gap = gap;
        }
    }

    let span = 13 - max_gap + 1;
    let needed_jokers = span - values.len() as u8;

    needed_jokers <= jokers as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::card::Suit;

    #[test]
    fn test_valid_trio_no_joker() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Five,
            },
            Card::Standard {
                suit: Suit::Clubs,
                value: Value::Five,
            },
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Five,
            },
        ];
        assert!(is_valid_trio(&cards));
    }

    #[test]
    fn test_valid_trio_with_joker() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Five,
            },
            Card::Joker,
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Five,
            },
        ];
        assert!(is_valid_trio(&cards));
    }

    #[test]
    fn test_invalid_trio_mixed_values() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Five,
            },
            Card::Standard {
                suit: Suit::Clubs,
                value: Value::Six,
            },
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Five,
            },
        ];
        assert!(!is_valid_trio(&cards));
    }

    #[test]
    fn test_invalid_trio_too_many_jokers() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Five,
            },
            Card::Joker,
            Card::Joker,
        ];
        assert!(!is_valid_trio(&cards));
    }

    #[test]
    fn test_valid_escala_no_joker() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Three,
            },
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Four,
            },
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Five,
            },
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Six,
            },
        ];
        assert!(is_valid_escala(&cards));
    }

    #[test]
    fn test_valid_escala_with_joker_gap() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Three,
            },
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Four,
            },
            Card::Joker,
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Six,
            },
        ];
        assert!(is_valid_escala(&cards));
    }

    #[test]
    fn test_valid_escala_wrapping_k_a_2() {
        let cards = vec![
            Card::Standard {
                suit: Suit::Spades,
                value: Value::King,
            },
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Ace,
            },
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Two,
            },
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Three,
            },
        ];
        assert!(is_valid_escala(&cards));
    }
}
