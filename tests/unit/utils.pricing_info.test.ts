import { describe, expect, it } from 'vitest';

import { ACTOR_PRICING_MODEL } from '../../src/const.js';
import type { PricingInfo } from '../../src/types.js';
import { pricingInfoToString, pricingInfoToStructured } from '../../src/utils/pricing_info.js';

// Helper factory functions
function makePricePerDatasetItem(opts: {
    pricePerUnitUsd?: number;
    unitName?: string;
    tieredPricing?: Record<string, { tieredPricePerUnitUsd: number }>;
}): PricingInfo {
    return {
        pricingModel: ACTOR_PRICING_MODEL.PRICE_PER_DATASET_ITEM,
        pricePerUnitUsd: opts.pricePerUnitUsd,
        unitName: opts.unitName ?? 'result',
        tieredPricing: opts.tieredPricing,
        startedAt: new Date('2024-01-01'),
    } as unknown as PricingInfo;
}

function makeFlatPricePerMonth(opts: {
    pricePerUnitUsd?: number;
    trialMinutes?: number;
    tieredPricing?: Record<string, { tieredPricePerUnitUsd: number }>;
}): PricingInfo {
    return {
        pricingModel: ACTOR_PRICING_MODEL.FLAT_PRICE_PER_MONTH,
        pricePerUnitUsd: opts.pricePerUnitUsd,
        trialMinutes: opts.trialMinutes ?? 60,
        tieredPricing: opts.tieredPricing,
        startedAt: new Date('2024-01-01'),
    } as unknown as PricingInfo;
}

function makePayPerEvent(opts: {
    events: Record<string, {
        eventTitle: string;
        eventDescription?: string;
        eventPriceUsd?: number;
        eventTieredPricingUsd?: Record<string, { tieredEventPriceUsd: number }>;
    }>;
}): PricingInfo {
    return {
        pricingModel: ACTOR_PRICING_MODEL.PAY_PER_EVENT,
        pricingPerEvent: { actorChargeEvents: opts.events },
        startedAt: new Date('2024-01-01'),
    } as unknown as PricingInfo;
}

const TIERS = {
    BRONZE: { tieredPricePerUnitUsd: 0.002 },
    SILVER: { tieredPricePerUnitUsd: 0.0015 },
    GOLD: { tieredPricePerUnitUsd: 0.001 },
};

describe('pricingInfoToStructured', () => {
    describe('FREE model', () => {
        it('returns free pricing for null', () => {
            const result = pricingInfoToStructured(null);
            expect(result.model).toBe(ACTOR_PRICING_MODEL.FREE);
            expect(result.isFree).toBe(true);
            expect(result.resolvedForTier).toBeUndefined();
        });
    });

    describe('PRICE_PER_DATASET_ITEM', () => {
        it('resolves tiered price for matching user tier', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.003, tieredPricing: TIERS });
            const result = pricingInfoToStructured(info, 'SILVER');
            expect(result.pricePerUnit).toBe(0.0015);
            expect(result.resolvedForTier).toBe('SILVER');
        });

        it('falls back to base price when user tier not in tiers', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.003, tieredPricing: TIERS });
            const result = pricingInfoToStructured(info, 'DIAMOND');
            expect(result.pricePerUnit).toBe(0.003);
            expect(result.resolvedForTier).toBe('base');
        });

        it('falls back to base price when userTier is null', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.003, tieredPricing: TIERS });
            const result = pricingInfoToStructured(info, null);
            expect(result.pricePerUnit).toBe(0.003);
            expect(result.resolvedForTier).toBe('base');
        });

        it('uses pricePerUnitUsd when no tieredPricing', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.005 });
            const result = pricingInfoToStructured(info, 'BRONZE');
            expect(result.pricePerUnit).toBe(0.005);
            expect(result.resolvedForTier).toBeUndefined();
        });

        it('falls back to first tier when userTier is null and no base price', () => {
            const info = makePricePerDatasetItem({ tieredPricing: TIERS });
            const result = pricingInfoToStructured(info, null);
            expect(result.pricePerUnit).toBeUndefined();
            expect(result.resolvedForTier).toBe('base');
        });
    });

    describe('FLAT_PRICE_PER_MONTH', () => {
        it('resolves tiered price for matching user tier', () => {
            const info = makeFlatPricePerMonth({ pricePerUnitUsd: 50, trialMinutes: 120, tieredPricing: TIERS });
            const result = pricingInfoToStructured(info, 'GOLD');
            expect(result.pricePerUnit).toBe(0.001);
            expect(result.resolvedForTier).toBe('GOLD');
            expect(result.trialMinutes).toBe(120);
        });

        it('falls back to base when no matching tier', () => {
            const info = makeFlatPricePerMonth({ pricePerUnitUsd: 50, tieredPricing: TIERS });
            const result = pricingInfoToStructured(info, null);
            expect(result.pricePerUnit).toBe(50);
            expect(result.resolvedForTier).toBe('base');
        });
    });

    describe('PAY_PER_EVENT', () => {
        it('resolves flat event price (no tiering)', () => {
            const info = makePayPerEvent({
                events: {
                    search: { eventTitle: 'Search', eventDescription: 'A search', eventPriceUsd: 0.01 },
                },
            });
            const result = pricingInfoToStructured(info, 'BRONZE');
            expect(result.events).toHaveLength(1);
            expect(result.events![0].priceUsd).toBe(0.01);
            expect(result.resolvedForTier).toBeUndefined();
        });

        it('resolves tiered event price for matching tier', () => {
            const info = makePayPerEvent({
                events: {
                    search: {
                        eventTitle: 'Search',
                        eventTieredPricingUsd: {
                            BRONZE: { tieredEventPriceUsd: 0.005 },
                            SILVER: { tieredEventPriceUsd: 0.003 },
                        },
                    },
                },
            });
            const result = pricingInfoToStructured(info, 'BRONZE');
            expect(result.events![0].priceUsd).toBe(0.005);
            expect(result.resolvedForTier).toBe('BRONZE');
        });

        it('falls back to first tier for tiered events when user tier unknown', () => {
            const info = makePayPerEvent({
                events: {
                    search: {
                        eventTitle: 'Search',
                        eventTieredPricingUsd: {
                            BRONZE: { tieredEventPriceUsd: 0.005 },
                        },
                    },
                },
            });
            const result = pricingInfoToStructured(info, null);
            expect(result.events![0].priceUsd).toBe(0.005);
            expect(result.resolvedForTier).toBe('base');
        });
    });
});

describe('pricingInfoToString', () => {
    it('returns free text for null', () => {
        expect(pricingInfoToString(null)).toContain('free to use');
    });

    describe('PRICE_PER_DATASET_ITEM with tiered pricing', () => {
        it('includes tier note for matched tier', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.003, tieredPricing: TIERS });
            const result = pricingInfoToString(info, 'BRONZE');
            expect(result).toContain('(your BRONZE plan price)');
            expect(result).toContain('2'); // 0.002 * 1000 = 2
        });

        it('includes base note when tier not found', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.003, tieredPricing: TIERS });
            const result = pricingInfoToString(info, 'DIAMOND');
            expect(result).toContain('(base price; see Actor pricing page for all tiers)');
        });

        it('no tier note without tiered pricing', () => {
            const info = makePricePerDatasetItem({ pricePerUnitUsd: 0.003 });
            const result = pricingInfoToString(info, 'BRONZE');
            expect(result).not.toContain('plan price');
            expect(result).not.toContain('base price');
        });
    });

    describe('PAY_PER_EVENT with tiered pricing', () => {
        it('includes tier note for tiered events', () => {
            const info = makePayPerEvent({
                events: {
                    search: {
                        eventTitle: 'Search',
                        eventDescription: 'Do search',
                        eventTieredPricingUsd: {
                            BRONZE: { tieredEventPriceUsd: 0.01 },
                            SILVER: { tieredEventPriceUsd: 0.008 },
                        },
                    },
                },
            });
            const result = pricingInfoToString(info, 'BRONZE');
            expect(result).toContain('$0.01 per event');
            expect(result).toContain('(your BRONZE plan price)');
        });

        it('includes base note for tiered events when tier not matched', () => {
            const info = makePayPerEvent({
                events: {
                    search: {
                        eventTitle: 'Search',
                        eventDescription: 'Do search',
                        eventTieredPricingUsd: {
                            BRONZE: { tieredEventPriceUsd: 0.01 },
                        },
                    },
                },
            });
            const result = pricingInfoToString(info, 'DIAMOND');
            expect(result).toContain('(base price; see Actor pricing page for all tiers)');
        });
    });
});
