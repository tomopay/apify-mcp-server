/**
 * Tests for Skyfire tool decoration logic: `SkyfirePaymentProvider.decorateToolSchema` and `cloneToolEntry`.
 *
 * Covers:
 * - paymentRequired tools are decorated; others are returned unchanged
 * - Idempotency (double-apply does not duplicate)
 * - Frozen originals are not mutated
 * - `cloneToolEntry` preserves functions (ajvValidate, call)
 * - Actor tools, internal tools, and actor-mcp tools
 */
import { describe, expect, it, vi } from 'vitest';

import {
    SKYFIRE_PAY_ID_PROPERTY_DESCRIPTION,
    SKYFIRE_TOOL_INSTRUCTIONS,
} from '../../src/const.js';
import { SkyfirePaymentProvider } from '../../src/payments/skyfire.js';
import type { ActorMcpTool, ActorTool, HelperTool, ToolEntry } from '../../src/types.js';
import { cloneToolEntry } from '../../src/utils/tools.js';

const provider = new SkyfirePaymentProvider();

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_AJV_VALIDATE = vi.fn(() => true);

function makeInternalTool(overrides: Partial<HelperTool> = {}): HelperTool {
    return {
        name: 'call-actor',
        description: 'Call an Actor',
        type: 'internal',
        inputSchema: {
            type: 'object' as const,
            properties: { actor: { type: 'string' } },
        },
        ajvValidate: MOCK_AJV_VALIDATE as never,
        call: vi.fn(async () => ({ content: [] })),
        ...overrides,
    };
}

function makeActorTool(overrides: Partial<ActorTool> = {}): ActorTool {
    return {
        name: 'apify--web-scraper',
        description: 'Web scraper tool',
        type: 'actor',
        actorFullName: 'apify/web-scraper',
        inputSchema: {
            type: 'object' as const,
            properties: { url: { type: 'string' } },
        },
        ajvValidate: MOCK_AJV_VALIDATE as never,
        ...overrides,
    };
}

function makeActorMcpTool(overrides: Partial<ActorMcpTool> = {}): ActorMcpTool {
    return {
        name: 'some-mcp-tool',
        description: 'A proxied MCP tool',
        type: 'actor-mcp',
        originToolName: 'some-tool',
        actorId: 'apify/some-actor',
        serverId: 'server-123',
        serverUrl: 'https://example.com/mcp',
        inputSchema: {
            type: 'object' as const,
            properties: { input: { type: 'string' } },
        },
        ajvValidate: MOCK_AJV_VALIDATE as never,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// cloneToolEntry
// ---------------------------------------------------------------------------

describe('cloneToolEntry', () => {
    it('should create a deep copy with independent data', () => {
        const original = makeInternalTool();
        const cloned = cloneToolEntry(original);

        // Different objects
        expect(cloned).not.toBe(original);
        expect(cloned.inputSchema).not.toBe(original.inputSchema);

        // Same data
        expect(cloned.name).toBe(original.name);
        expect(cloned.description).toBe(original.description);
        expect(cloned.type).toBe(original.type);
        expect(cloned.inputSchema).toEqual(original.inputSchema);
    });

    it('should preserve ajvValidate function reference', () => {
        const original = makeInternalTool();
        const cloned = cloneToolEntry(original);

        expect(cloned.ajvValidate).toBe(original.ajvValidate);
        expect(typeof cloned.ajvValidate).toBe('function');
    });

    it('should preserve call function reference for internal tools', () => {
        const original = makeInternalTool();
        const cloned = cloneToolEntry(original) as HelperTool;

        expect(cloned.call).toBe(original.call);
        expect(typeof cloned.call).toBe('function');
    });

    it('should work for actor tools (no call function)', () => {
        const original = makeActorTool();
        const cloned = cloneToolEntry(original);

        expect(cloned.ajvValidate).toBe(original.ajvValidate);
        expect(cloned.name).toBe(original.name);
        expect((cloned as ActorTool).actorFullName).toBe(original.actorFullName);
    });

    it('should not share nested objects with the original', () => {
        const original = makeInternalTool();
        const cloned = cloneToolEntry(original);

        // Mutate clone's inputSchema
        (cloned.inputSchema.properties as Record<string, unknown>).newProp = { type: 'number' };

        // Original should be unaffected
        expect((original.inputSchema.properties as Record<string, unknown>).newProp).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// SkyfirePaymentProvider.decorateToolSchema — paymentRequired tools
// ---------------------------------------------------------------------------

describe('SkyfirePaymentProvider.decorateToolSchema', () => {
    describe('paymentRequired tools', () => {
        it('should decorate an internal tool with paymentRequired: true', () => {
            const original = makeInternalTool({ paymentRequired: true });
            const result = provider.decorateToolSchema(original);

            expect(result).not.toBe(original);
            expect(result.description).toContain(SKYFIRE_TOOL_INSTRUCTIONS);

            const props = result.inputSchema.properties as Record<string, unknown>;
            expect(props['skyfire-pay-id']).toEqual({
                type: 'string',
                description: SKYFIRE_PAY_ID_PROPERTY_DESCRIPTION,
            });
            expect(Object.isFrozen(result)).toBe(true);
        });

        it('should decorate an actor tool with paymentRequired: true', () => {
            const original = makeActorTool({ paymentRequired: true });
            const result = provider.decorateToolSchema(original);

            expect(result).not.toBe(original);
            expect(result.description).toContain(SKYFIRE_TOOL_INSTRUCTIONS);

            const props = result.inputSchema.properties as Record<string, unknown>;
            expect(props['skyfire-pay-id']).toBeDefined();
            expect(Object.isFrozen(result)).toBe(true);
        });
    });

    describe('non-paymentRequired tools', () => {
        it('should return the original reference when paymentRequired is false', () => {
            const original = makeInternalTool({ paymentRequired: false });
            const result = provider.decorateToolSchema(original);

            expect(result).toBe(original);
            expect(result.description).not.toContain(SKYFIRE_TOOL_INSTRUCTIONS);
        });

        it('should return the original reference when paymentRequired is undefined', () => {
            const original = makeActorTool();
            const result = provider.decorateToolSchema(original);

            expect(result).toBe(original);
        });

        it('should return the original reference for actor-mcp tool without paymentRequired', () => {
            const original = makeActorMcpTool();
            const result = provider.decorateToolSchema(original);

            expect(result).toBe(original);
        });
    });

    describe('idempotency', () => {
        it('should not double-append description when called twice', () => {
            const original = makeInternalTool({ paymentRequired: true });
            const firstPass = provider.decorateToolSchema(original);
            const secondPass = provider.decorateToolSchema(firstPass);

            const occurrences = secondPass.description!.split(SKYFIRE_TOOL_INSTRUCTIONS).length - 1;
            expect(occurrences).toBe(1);
        });

        it('should not duplicate skyfire-pay-id property when called twice', () => {
            const original = makeActorTool({ paymentRequired: true });
            const firstPass = provider.decorateToolSchema(original);
            const secondPass = provider.decorateToolSchema(firstPass);

            const props = secondPass.inputSchema.properties as Record<string, unknown>;
            expect(props['skyfire-pay-id']).toEqual({
                type: 'string',
                description: SKYFIRE_PAY_ID_PROPERTY_DESCRIPTION,
            });
        });
    });

    describe('frozen originals', () => {
        it('should not mutate a frozen tool with paymentRequired: true', () => {
            const original = Object.freeze(makeInternalTool({ paymentRequired: true }));
            const result = provider.decorateToolSchema(original);

            expect(result.description).toContain(SKYFIRE_TOOL_INSTRUCTIONS);
            expect(original.description).not.toContain(SKYFIRE_TOOL_INSTRUCTIONS);
            expect(Object.isFrozen(original)).toBe(true);
        });

        it('should return frozen non-paymentRequired tool as-is', () => {
            const original = Object.freeze(makeInternalTool());
            const result = provider.decorateToolSchema(original);

            expect(result).toBe(original);
            expect(Object.isFrozen(result)).toBe(true);
        });
    });

    describe('function preservation', () => {
        it('should preserve ajvValidate on decorated internal tool', () => {
            const original = makeInternalTool({ paymentRequired: true });
            const result = provider.decorateToolSchema(original) as HelperTool;

            expect(result.ajvValidate).toBe(original.ajvValidate);
            expect(typeof result.ajvValidate).toBe('function');
        });

        it('should preserve call function on decorated internal tool', () => {
            const original = makeInternalTool({ paymentRequired: true });
            const result = provider.decorateToolSchema(original) as HelperTool;

            expect(result.call).toBe(original.call);
            expect(typeof result.call).toBe('function');
        });

        it('should preserve ajvValidate on decorated actor tool', () => {
            const original = makeActorTool({ paymentRequired: true });
            const result = provider.decorateToolSchema(original);

            expect(result.ajvValidate).toBe(original.ajvValidate);
        });
    });

    describe('edge cases', () => {
        it('should handle tool with no description gracefully', () => {
            const original = makeInternalTool({
                paymentRequired: true,
                description: undefined as unknown as string,
            });
            const result = provider.decorateToolSchema(original);

            expect(result.description).toBeUndefined();
        });

        it('should handle tool with empty inputSchema properties', () => {
            const original = makeInternalTool({
                paymentRequired: true,
                inputSchema: { type: 'object' as const, properties: {} },
            });
            const result = provider.decorateToolSchema(original);

            const props = result.inputSchema.properties as Record<string, unknown>;
            expect(props['skyfire-pay-id']).toBeDefined();
        });
    });
});

// ---------------------------------------------------------------------------
// Matrix: paymentRequired × tool type
// ---------------------------------------------------------------------------

describe('decorateToolSchema eligibility matrix', () => {
    const testCases: { tool: ToolEntry; decorated: boolean; label: string }[] = [
        { tool: makeInternalTool({ paymentRequired: true }), decorated: true, label: 'internal/paymentRequired' },
        { tool: makeActorTool({ paymentRequired: true }), decorated: true, label: 'actor/paymentRequired' },
        { tool: makeInternalTool({ paymentRequired: false }), decorated: false, label: 'internal/not-paymentRequired' },
        { tool: makeActorTool(), decorated: false, label: 'actor/no-paymentRequired' },
        { tool: makeActorMcpTool(), decorated: false, label: 'actor-mcp/no-paymentRequired' },
    ];

    for (const { tool, decorated, label } of testCases) {
        it(`${label}: decorated=${decorated}`, () => {
            const result = provider.decorateToolSchema(tool);

            if (decorated) {
                expect(result).not.toBe(tool);
                expect(result.description).toContain(SKYFIRE_TOOL_INSTRUCTIONS);
                const props = result.inputSchema.properties as Record<string, unknown>;
                expect(props['skyfire-pay-id']).toBeDefined();
            } else {
                expect(result).toBe(tool);
                expect(result.description).not.toContain(SKYFIRE_TOOL_INSTRUCTIONS);
            }
        });
    }
});
