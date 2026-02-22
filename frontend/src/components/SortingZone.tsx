import React, { useMemo, forwardRef } from 'react';
import { Card, type CardData } from './Card';
import { detectCombos, type DetectedCombo } from '../lib/comboDetection';
import './SortingZone.css';

export interface SortingCard {
    id: string;
    card: CardData;
}

interface SortingZoneProps {
    cards: SortingCard[];
    onReturnCard: (id: string) => void;
    isDropActive: boolean;
    /** Reorder cards within the sorting zone */
    onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * Renders cards grouped by detected combos.
 * Ungrouped cards render individually between combo groups.
 */
function buildRenderGroups(cards: SortingCard[], combos: DetectedCombo[]) {
    const groups: { type: 'combo' | 'single'; combo?: DetectedCombo; cards: SortingCard[]; startIndex: number }[] = [];

    let i = 0;
    let comboIdx = 0;
    const sortedCombos = [...combos].sort((a, b) => a.startIndex - b.startIndex);

    while (i < cards.length) {
        if (comboIdx < sortedCombos.length && i === sortedCombos[comboIdx].startIndex) {
            const combo = sortedCombos[comboIdx];
            groups.push({
                type: 'combo',
                combo,
                cards: cards.slice(combo.startIndex, combo.endIndex + 1),
                startIndex: combo.startIndex,
            });
            i = combo.endIndex + 1;
            comboIdx++;
        } else {
            groups.push({
                type: 'single',
                cards: [cards[i]],
                startIndex: i,
            });
            i++;
        }
    }
    return groups;
}

export const SortingZone = forwardRef<HTMLDivElement, SortingZoneProps>(({
    cards,
    onReturnCard,
    isDropActive,
    onReorder,
}, ref) => {
    const combos = useMemo(() => detectCombos(cards.map(c => c.card)), [cards]);
    const renderGroups = useMemo(() => buildRenderGroups(cards, combos), [cards, combos]);

    // Internal reorder via native drag within sorting zone
    const handleInternalDragStart = (idx: number, e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('text/sortingIdx', String(idx));
    };

    const handleInternalDrop = (targetIdx: number, e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const sourceIdxStr = e.dataTransfer.getData('text/sortingIdx');
        if (sourceIdxStr) {
            const sourceIdx = parseInt(sourceIdxStr, 10);
            if (!isNaN(sourceIdx) && sourceIdx !== targetIdx) {
                onReorder(sourceIdx, targetIdx);
            }
        }
    };

    const renderCard = (item: SortingCard, globalIdx: number) => (
        <div
            key={item.id}
            className="sorting-zone-card-wrapper"
            draggable
            onDragStart={(e) => handleInternalDragStart(globalIdx, e)}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => handleInternalDrop(globalIdx, e)}
        >
            <Card card={item.card} isDraggable={false} style={{ width: 50, height: 70, fontSize: '0.65rem' }} />
            <button
                className="sorting-card-return-btn"
                onClick={() => onReturnCard(item.id)}
                title="Return to hand"
            >✕</button>
        </div>
    );

    return (
        <div
            ref={ref}
            className={`sorting-zone ${isDropActive ? 'drop-active' : ''}`}
        >
            <div className="sorting-zone-header">
                <span>🃏 Mesa de trabajo</span>
                <span>{cards.length} cards</span>
            </div>

            {cards.length === 0 ? (
                <div className="sorting-zone-empty">
                    Drag cards here to organize combos
                </div>
            ) : (
                <div className="sorting-zone-cards">
                    {renderGroups.map((group, gIdx) => {
                        if (group.type === 'combo' && group.combo) {
                            return (
                                <div key={`combo-${gIdx}`} className={`combo-group-wrapper ${group.combo.type}`}>
                                    <div className="combo-header-row">
                                        <span className="combo-label">{group.combo.type === 'trio' ? 'Trío' : 'Escala'}</span>
                                        <button
                                            className="unlink-btn"
                                            title="Unlink combo"
                                            onClick={() => onReorder(group.startIndex, cards.length - 1)}
                                        >
                                            💔
                                        </button>
                                    </div>
                                    <div className="combo-cards-row">
                                        {group.cards.map((item, cardIdx) => renderCard(item, group.startIndex + cardIdx))}
                                    </div>
                                </div>
                            );
                        }
                        return renderCard(group.cards[0], group.startIndex);
                    })}
                </div>
            )}
        </div>
    );
});

SortingZone.displayName = 'SortingZone';
