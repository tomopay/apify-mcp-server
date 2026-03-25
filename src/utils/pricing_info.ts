import { ACTOR_PRICING_MODEL } from '../const.js';
import type { ActorChargeEvent, PricingInfo, PricingTier } from '../types.js';

/**
 * Custom type to transform raw API pricing data into a clean, client-friendly format
 * that matches the style of the unstructured text output instead of using the raw API format.
 */
export type StructuredPricingInfo = {
    model: string;
    isFree: boolean;
    pricePerUnit?: number;
    unitName?: string;
    trialMinutes?: number;
    /** The tier this price was resolved for (e.g. "BRONZE"), or "base" when falling back */
    resolvedForTier?: string;
    events?: {
        title: string;
        description: string;
        priceUsd?: number;
    }[];
}

/**
 * Returns the most recent valid pricing information from a list of pricing infos,
 * based on the provided current date.
 *
 * Filters out pricing infos that have a `startedAt` date in the future or missing,
 * then sorts the remaining infos by `startedAt` in descending order (most recent first).
 * Returns the most recent valid pricing info, or `null` if none are valid.
 */
export function getCurrentPricingInfo(pricingInfos: PricingInfo[], now: Date): PricingInfo | null {
    // Filter out all future dates and those without a startedAt date
    const validPricingInfos = pricingInfos.filter((info) => {
        if (!info.startedAt) return false;
        const startedAt = new Date(info.startedAt);
        return startedAt <= now;
    });

    // Sort and return the most recent pricing info
    validPricingInfos.sort((a, b) => {
        const aDate = new Date(a.startedAt || 0);
        const bDate = new Date(b.startedAt || 0);
        return bDate.getTime() - aDate.getTime(); // Sort descending
    });
    if (validPricingInfos.length > 0) {
        return validPricingInfos[0]; // Return the most recent pricing info
    }

    return null;
}

function convertMinutesToGreatestUnit(minutes: number): { value: number; unit: string } {
    if (minutes < 60) {
        return { value: minutes, unit: 'minutes' };
    } if (minutes < 60 * 24) { // Less than 24 hours
        return { value: Math.floor(minutes / 60), unit: 'hours' };
    } // 24 hours or more
    return { value: Math.floor(minutes / (60 * 24)), unit: 'days' };
}

/** Resolve a single price from tiered pricing for the user's tier, with fallback to base price. */
function resolveTieredUnitPrice(
    tieredPricing: Record<string, { tieredPricePerUnitUsd: number }>,
    userTier: PricingTier | null | undefined,
    basePrice: number | undefined,
): { price: number | undefined; label: string } {
    if (userTier && tieredPricing[userTier]) {
        return { price: tieredPricing[userTier].tieredPricePerUnitUsd, label: userTier };
    }
    return { price: basePrice, label: 'base' };
}

/** Resolve a single event price for the user's tier. */
function resolveEventPrice(
    event: ActorChargeEvent,
    userTier: PricingTier | null | undefined,
): { price: number | undefined; label: string } {
    if (typeof event.eventPriceUsd === 'number') return { price: event.eventPriceUsd, label: '' };
    if (event.eventTieredPricingUsd) {
        if (userTier && event.eventTieredPricingUsd[userTier]) {
            return { price: event.eventTieredPricingUsd[userTier]!.tieredEventPriceUsd, label: userTier };
        }
        const first = Object.values(event.eventTieredPricingUsd)[0];
        return { price: first?.tieredEventPriceUsd, label: 'base' };
    }
    return { price: undefined, label: '' };
}

/** Short note appended to pricing strings when tier was resolved. */
function tierNote(label: string): string {
    if (!label) return '';
    if (label === 'base') return ' (base price; see Actor pricing page for all tiers)';
    return ` (your ${label} plan price)`;
}

/**
 * Formats the pay-per-event pricing information into a human-readable string.
 *
 * Example:
 * This Actor is paid per event. You are not charged for the Apify platform usage, but only a fixed price for the following events:
 *         - Event title: Event description (Flat price: $X per event)
 *         - MCP server startup: Initial fee for starting the Kiwi MCP Server Actor (Flat price: $0.1 per event)
 *         - Flight search: Fee for searching flights using the Kiwi.com flight search engine (Flat price: $0.001 per event)
 *
 * For tiered pricing, the output is more complicated and the question is whether we want to simplify it in the future.
 * @param pricingPerEvent
 */

function payPerEventPricingToString(
    pricingPerEvent: { actorChargeEvents: Record<string, ActorChargeEvent> } | undefined,
    userTier?: PricingTier | null,
): string {
    if (!pricingPerEvent || !pricingPerEvent.actorChargeEvents) return 'Pricing information for events is not available.';
    const eventStrings: string[] = [];
    for (const event of Object.values(pricingPerEvent.actorChargeEvents)) {
        const { price, label } = resolveEventPrice(event, userTier);
        let eventStr = `\t- **${event.eventTitle}**: ${event.eventDescription} `;
        if (price !== undefined) {
            eventStr += `(Flat price: $${price} per event)${tierNote(label)}`;
        } else {
            eventStr += '(No price info)';
        }
        eventStrings.push(eventStr);
    }
    return `This Actor is paid per event. You are not charged for the Apify platform usage, but only a fixed price for the following events:\n${eventStrings.join('\n')}`;
}

export function pricingInfoToString(pricingInfo: PricingInfo | null, userTier?: PricingTier | null): string {
    // If there is no pricing infos entries the Actor is free to use
    // based on https://github.com/apify/apify-core/blob/058044945f242387dde2422b8f1bef395110a1bf/src/packages/actor/src/paid_actors/paid_actors_common.ts#L691
    if (pricingInfo === null || pricingInfo.pricingModel === ACTOR_PRICING_MODEL.FREE) {
        return 'This Actor is free to use. You are only charged for Apify platform usage.';
    }
    if (pricingInfo.pricingModel === ACTOR_PRICING_MODEL.PRICE_PER_DATASET_ITEM) {
        const customUnitName = pricingInfo.unitName !== 'result' ? pricingInfo.unitName : '';
        if (pricingInfo.tieredPricing && Object.keys(pricingInfo.tieredPricing).length > 0) {
            const { price, label } = resolveTieredUnitPrice(pricingInfo.tieredPricing, userTier, pricingInfo.pricePerUnitUsd);
            const per1000 = price !== undefined ? price * 1000 : 'N/A';
            return `This Actor charges per results${customUnitName ? ` (in this case named ${customUnitName})` : ''}; the price per 1000 ${customUnitName || 'results'} is ${per1000} USD.${tierNote(label)}`;
        }
        return `This Actor charges per results${customUnitName ? ` (in this case named ${customUnitName})` : ''}; the price per 1000 ${customUnitName || 'results'} is ${pricingInfo.pricePerUnitUsd as number * 1000} USD.`;
    }
    if (pricingInfo.pricingModel === ACTOR_PRICING_MODEL.FLAT_PRICE_PER_MONTH) {
        const { value, unit } = convertMinutesToGreatestUnit(pricingInfo.trialMinutes || 0);
        if (pricingInfo.tieredPricing && Object.keys(pricingInfo.tieredPricing).length > 0) {
            const { price, label } = resolveTieredUnitPrice(pricingInfo.tieredPricing, userTier, pricingInfo.pricePerUnitUsd);
            return `This Actor is rental and has a flat price of ${price ?? 'N/A'} USD per month, with a trial period of ${value} ${unit}.${tierNote(label)}`;
        }
        return `This Actor is rental and has a flat price of ${pricingInfo.pricePerUnitUsd} USD per month, with a trial period of ${value} ${unit}.`;
    }
    if (pricingInfo.pricingModel === ACTOR_PRICING_MODEL.PAY_PER_EVENT) {
        return payPerEventPricingToString(pricingInfo.pricingPerEvent, userTier);
    }
    return 'Pricing information is not available.';
}

/**
 * Transform and normalize API response to match unstructured text output format
 * instead of just dumping raw API data - ensures consistency across structured & unstructured modes.
 */
export function pricingInfoToStructured(pricingInfo: PricingInfo | null, userTier?: PricingTier | null): StructuredPricingInfo {
    const structuredPricing: StructuredPricingInfo = {
        model: pricingInfo?.pricingModel || ACTOR_PRICING_MODEL.FREE,
        isFree: !pricingInfo || pricingInfo.pricingModel === ACTOR_PRICING_MODEL.FREE,
    };

    if (!pricingInfo || pricingInfo.pricingModel === ACTOR_PRICING_MODEL.FREE) {
        return structuredPricing;
    }

    if (pricingInfo.pricingModel === ACTOR_PRICING_MODEL.PRICE_PER_DATASET_ITEM) {
        structuredPricing.unitName = pricingInfo.unitName || 'result';

        if (pricingInfo.tieredPricing && Object.keys(pricingInfo.tieredPricing).length > 0) {
            const { price, label } = resolveTieredUnitPrice(pricingInfo.tieredPricing, userTier, pricingInfo.pricePerUnitUsd);
            structuredPricing.pricePerUnit = price;
            structuredPricing.resolvedForTier = label;
        } else {
            structuredPricing.pricePerUnit = pricingInfo.pricePerUnitUsd || 0;
        }
    } else if (pricingInfo.pricingModel === ACTOR_PRICING_MODEL.FLAT_PRICE_PER_MONTH) {
        structuredPricing.trialMinutes = pricingInfo.trialMinutes;

        if (pricingInfo.tieredPricing && Object.keys(pricingInfo.tieredPricing).length > 0) {
            const { price, label } = resolveTieredUnitPrice(pricingInfo.tieredPricing, userTier, pricingInfo.pricePerUnitUsd);
            structuredPricing.pricePerUnit = price;
            structuredPricing.resolvedForTier = label;
        } else {
            structuredPricing.pricePerUnit = pricingInfo.pricePerUnitUsd;
        }
    } else if (pricingInfo.pricingModel === ACTOR_PRICING_MODEL.PAY_PER_EVENT) {
        if (pricingInfo.pricingPerEvent?.actorChargeEvents) {
            const { actorChargeEvents } = pricingInfo.pricingPerEvent;
            let resolvedLabel = '';
            structuredPricing.events = Object.values(actorChargeEvents).map((event) => {
                const actorEvent = event as ActorChargeEvent;
                const { price, label } = resolveEventPrice(actorEvent, userTier);
                if (label) resolvedLabel = label;
                return {
                    title: actorEvent.eventTitle,
                    description: actorEvent.eventDescription || '',
                    priceUsd: price,
                };
            });
            if (resolvedLabel) structuredPricing.resolvedForTier = resolvedLabel;
        }
    }

    return structuredPricing;
}
