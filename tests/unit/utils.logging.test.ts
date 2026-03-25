import { describe, expect, it } from 'vitest';

import { SkyfirePaymentProvider } from '../../src/payments/skyfire.js';

const provider = new SkyfirePaymentProvider();

describe('SkyfirePaymentProvider.redactForLogging', () => {
    it('should redact skyfire-pay-id when present', () => {
        const params = { 'skyfire-pay-id': 'secret-token-123', actor: 'apify/web-scraper', url: 'https://example.com' };
        const result = provider.redactForLogging(params);
        expect(result).toEqual({ 'skyfire-pay-id': '[REDACTED]', actor: 'apify/web-scraper', url: 'https://example.com' });
    });

    it('should return params unchanged when skyfire-pay-id is not present', () => {
        const params = { actor: 'apify/web-scraper', url: 'https://example.com' };
        const result = provider.redactForLogging(params);
        expect(result).toBe(params); // same reference, no copy
    });

    it('should return null as-is', () => {
        expect(provider.redactForLogging(null)).toBeNull();
    });

    it('should return undefined as-is', () => {
        expect(provider.redactForLogging(undefined)).toBeUndefined();
    });

    it('should return primitives as-is', () => {
        expect(provider.redactForLogging('string')).toBe('string');
        expect(provider.redactForLogging(42)).toBe(42);
        expect(provider.redactForLogging(true)).toBe(true);
    });

    it('should return arrays as-is', () => {
        const arr = [1, 2, 3];
        expect(provider.redactForLogging(arr)).toBe(arr);
    });

    it('should return empty object as-is', () => {
        const params = {};
        expect(provider.redactForLogging(params)).toBe(params);
    });

    it('should not mutate the original object', () => {
        const params = { 'skyfire-pay-id': 'secret', foo: 'bar' };
        provider.redactForLogging(params);
        expect(params['skyfire-pay-id']).toBe('secret');
    });

    it('should handle skyfire-pay-id with empty string value', () => {
        const params = { 'skyfire-pay-id': '', other: 'value' };
        const result = provider.redactForLogging(params);
        expect(result).toEqual({ 'skyfire-pay-id': '[REDACTED]', other: 'value' });
    });

    it('should not redact if already redacted', () => {
        const params = { 'skyfire-pay-id': '[REDACTED]', other: 'value' };
        const result = provider.redactForLogging(params);
        expect(result).toBe(params); // same reference, already redacted
    });
});
