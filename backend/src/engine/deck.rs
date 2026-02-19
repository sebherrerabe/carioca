use crate::engine::card::{Card, Suit, Value};
use rand::seq::SliceRandom;
// use rand::thread_rng; // rand 0.9 removed this from root
use rand::rng;

pub struct Deck {
    cards: Vec<Card>,
}

impl Deck {
    /// Creates a standard Carioca deck consisting of two standard 52-card decks
    /// plus 4 jokers, totaling 108 cards.
    pub fn new() -> Self {
        let mut cards = Vec::with_capacity(108);

        for _ in 0..2 {
            for suit in [Suit::Hearts, Suit::Diamonds, Suit::Clubs, Suit::Spades] {
                for value in [
                    Value::Two,
                    Value::Three,
                    Value::Four,
                    Value::Five,
                    Value::Six,
                    Value::Seven,
                    Value::Eight,
                    Value::Nine,
                    Value::Ten,
                    Value::Jack,
                    Value::Queen,
                    Value::King,
                    Value::Ace,
                ] {
                    cards.push(Card::Standard { suit, value });
                }
            }
            // 2 Jokers per deck
            cards.push(Card::Joker);
            cards.push(Card::Joker);
        }

        Self { cards }
    }

    pub fn shuffle(&mut self) {
        let mut rng = rng();
        self.cards.shuffle(&mut rng);
    }

    pub fn draw(&mut self) -> Option<Card> {
        self.cards.pop()
    }

    pub fn remaining(&self) -> usize {
        self.cards.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deck_creation() {
        let deck = Deck::new();
        assert_eq!(deck.remaining(), 108);

        let jokers = deck.cards.iter().filter(|c| c.is_joker()).count();
        assert_eq!(jokers, 4);
    }

    #[test]
    fn test_deck_draw() {
        let mut deck = Deck::new();
        let initial_len = deck.remaining();

        let card = deck.draw();
        assert!(card.is_some());
        assert_eq!(deck.remaining(), initial_len - 1);
    }
}
