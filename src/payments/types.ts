import type { ToolEntry } from '../types.js';

/**
 * Supported payment provider identifiers.
 * - 'skyfire': Skyfire agentic payments (PAY token in tool args)
 * - 'x402': x402 protocol (HTTP 402 + PAYMENT-SIGNATURE header)
 */
export type PaymentProviderId = 'skyfire' | 'x402';

/**
 * Interface for payment providers.
 *
 * Each payment scheme implements this interface to handle:
 * - Tool schema augmentation (e.g., adding payment fields to tool definitions)
 * - Payment credential extraction from tool call arguments
 * - Apify API client configuration for forwarding payment credentials
 * - Payment validation before tool execution
 */
export type PaymentProvider = {
    /** The identifier of this payment scheme */
    readonly id: PaymentProviderId;

    /**
     * Augment a tool definition for this payment scheme.
     * Called when tools are registered/upserted in the MCP server.
     *
     * Only tools with `paymentRequired: true` should be augmented.
     * Must be idempotent — calling twice on the same tool produces the same result.
     *
     * @returns The augmented tool (new object), or the original if no augmentation needed.
     */
    augmentTool(tool: ToolEntry): ToolEntry;

    /**
     * Validate that required payment credentials are present in tool call arguments.
     * Called before executing tools with `paymentRequired: true`.
     *
     * @returns An error message string if validation fails, or null if valid.
     */
    validatePayment(args: Record<string, unknown>): string | null;

    /**
     * Extract payment credentials from tool call arguments and return
     * request interceptor config for the Apify API client.
     *
     * @returns Headers to attach to outbound Apify API requests, or empty object if none.
     */
    getPaymentHeaders(args: Record<string, unknown>): Record<string, string>;

    /**
     * Strip payment-specific fields from tool call arguments before passing
     * them as Actor input. Returns cleaned args (new object).
     */
    stripPaymentArgs(args: Record<string, unknown>): Record<string, unknown>;

    /**
     * Whether this payment mode allows unauthenticated access (no Apify token required).
     * Skyfire: true (uses PAY token instead)
     * x402: true (uses blockchain payment instead)
     */
    readonly allowsUnauthenticated: boolean;

    /**
     * Optional: Get a readme/usage guide resource for this payment mode.
     * @returns Resource content string, or null if no guide is available.
     */
    getUsageGuide?(): string | null;

    /**
     * Redact sensitive payment fields from args for logging purposes.
     * @returns A new object with sensitive fields replaced by '[REDACTED]'.
     */
    redactArgs(args: unknown): unknown;
}
