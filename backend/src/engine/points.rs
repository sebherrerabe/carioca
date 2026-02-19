use crate::engine::card::Card;

pub fn calculate_hand_points(hand: &[Card]) -> u32 {
    hand.iter().map(|card| card.points()).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::card::{Suit, Value};

    #[test]
    fn test_calculate_points() {
        let hand = vec![
            Card::Standard {
                suit: Suit::Hearts,
                value: Value::Two,
            }, // 2
            Card::Standard {
                suit: Suit::Spades,
                value: Value::Ten,
            }, // 10
            Card::Joker, // 50
            Card::Standard {
                suit: Suit::Diamonds,
                value: Value::Ace,
            }, // 20
        ];

        assert_eq!(calculate_hand_points(&hand), 82);
    }
}
