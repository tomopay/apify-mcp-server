import type { ApifyClientOptions } from 'apify';
import { ApifyClient as _ApifyClient } from 'apify-client';
import type { AxiosRequestConfig } from 'axios';

import { USER_AGENT_ORIGIN } from './const.js';
import type { ActorsMcpServer } from './mcp/server.js';
import type { ApifyToken } from './types.js';

type ExtendedApifyClientOptions = Omit<ApifyClientOptions, 'token'> & {
    token?: string | null | undefined;
    /** Payment headers to forward on outbound API requests (from PaymentProvider.getPaymentHeaders) */
    paymentHeaders?: Record<string, string>;
};

/**
 * Adds a User-Agent header to the request config.
 * @param config
 * @private
 */
function addUserAgent(config: AxiosRequestConfig): AxiosRequestConfig {
    const updatedConfig = { ...config };
    updatedConfig.headers = updatedConfig.headers ?? {};
    updatedConfig.headers['User-Agent'] = `${updatedConfig.headers['User-Agent'] ?? ''}; ${USER_AGENT_ORIGIN}`;
    return updatedConfig;
}

export function getApifyAPIBaseUrl(): string {
    // Workaround for Actor server where the platform APIFY_API_BASE_URL did not work with getActorDefinition from actors.ts
    if (process.env.APIFY_IS_AT_HOME) return 'https://api.apify.com';
    return process.env.APIFY_API_BASE_URL || 'https://api.apify.com';
}

export class ApifyClient extends _ApifyClient {
    constructor(options: ExtendedApifyClientOptions) {
        /**
         * In order to publish to DockerHub, we need to run their build task to validate our MCP server.
         * This was failing since we were sending this dummy token to Apify in order to build the Actor tools.
         * So if we encounter this dummy value, we remove it to use Apify client as unauthenticated, which is sufficient
         * for server start and listing of tools.
         */
        if (options.token?.toLowerCase() === 'your-apify-token' || options.token === null) {
            // eslint-disable-next-line no-param-reassign
            delete options.token;
        }

        const { paymentHeaders, ...clientOptions } = options;
        const requestInterceptors = [addUserAgent];
        /**
         * Add payment headers if provided by a PaymentProvider.
         */
        if (paymentHeaders && Object.keys(paymentHeaders).length > 0) {
            requestInterceptors.push((config) => {
                const updatedConfig = { ...config };
                updatedConfig.headers = updatedConfig.headers ?? {};
                Object.assign(updatedConfig.headers, paymentHeaders);
                return updatedConfig;
            });
        }

        super({
            // token null case is handled, we can assert type here
            ...clientOptions as ApifyClientOptions,
            baseUrl: getApifyAPIBaseUrl(),
            requestInterceptors,
        });
    }
}

/**
 * Creates ApifyClient with appropriate credentials based on payment mode.
 * When a payment provider is active, forwards payment headers via request interceptors;
 * otherwise uses the standard apifyToken.
 *
 * @param apifyMcpServer - The MCP server instance with configuration options
 * @param args - Tool arguments that may contain payment credentials
 * @param apifyToken - Standard Apify token for non-payment mode
 * @returns ApifyClient instance configured for the appropriate mode
 */
export function createApifyClientWithPaymentSupport(
    apifyMcpServer: ActorsMcpServer,
    args: Record<string, unknown>,
    apifyToken: ApifyToken,
): ApifyClient {
    const provider = apifyMcpServer.options.paymentProvider;
    if (provider) {
        const paymentHeaders = provider.getPaymentHeaders(args);
        if (Object.keys(paymentHeaders).length > 0) {
            return new ApifyClient({ paymentHeaders });
        }
    }
    return new ApifyClient({ token: apifyToken });
}
