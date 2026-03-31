#!/usr/bin/env node

/**
 * Payment-gated entry point for the Apify MCP server.
 *
 * Wraps the standard Apify MCP server with Tomopay's `withPayments()` so AI
 * agents can pay per tool call using x402 (USDC on Base) or MPP (Stripe's
 * Machine Payments Protocol).
 *
 * Usage:
 *   APIFY_TOKEN=<token> TOMOPAY_ADDRESS=<wallet> npx actors-mcp-server-pay
 *
 * Environment variables:
 *   APIFY_TOKEN       — Required. Your Apify API token.
 *   TOMOPAY_ADDRESS   — Required. Wallet/Stripe account to receive payments.
 *   TOMOPAY_PROTOCOL  — Optional. "x402" | "mpp" | "x402,mpp" (default: both)
 *
 * Pricing defaults (override via TOMOPAY_PRICE_* env vars, amounts in USD cents):
 *   call-actor / run-actor:   $0.10  (TOMOPAY_PRICE_RUN_ACTOR,   default: 10)
 *   search-actors:            $0.05  (TOMOPAY_PRICE_SEARCH,       default: 5)
 *   fetch-actor-details:      $0.05  (TOMOPAY_PRICE_DETAILS,      default: 5)
 *   get-actor-run / output:   $0.01  (TOMOPAY_PRICE_RUN_STATUS,   default: 1)
 *   storage / dataset reads:  $0.01  (TOMOPAY_PRICE_STORAGE,      default: 1)
 *   docs / search-docs:       $0.01  (TOMOPAY_PRICE_DOCS,         default: 1)
 */

// Sentry must be imported before all other modules to ensure early initialization
import './instrument.js';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { withPayments } from '@tomopay/gateway';
import yargs from 'yargs';
// eslint-disable-next-line import/extensions
import { hideBin } from 'yargs/helpers';

import log from '@apify/log';

import { ApifyClient } from './apify_client.js';
import { DEFAULT_TELEMETRY_ENV, TELEMETRY_ENV } from './const.js';
import { processInput } from './input.js';
import { ActorsMcpServer } from './mcp/server.js';
import { getTelemetryEnv } from './telemetry.js';
import type { ApifyRequestParams, Input, TelemetryEnv, ToolSelector, UiMode } from './types.js';
import { parseUiMode } from './types.js';
import { isApiTokenRequired } from './utils/auth.js';
import { parseCommaSeparatedList } from './utils/generic.js';
import { loadToolsFromInput } from './utils/tools_loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CliArgs = {
    actors?: string;
    enableAddingActors: boolean;
    enableActorAutoLoading: boolean;
    tools?: string;
    telemetryEnabled: boolean;
    telemetryEnv: TelemetryEnv;
    ui: UiMode;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTokenFromAuthFile(): string | undefined {
    try {
        const authPath = join(homedir(), '.apify', 'auth.json');
        const content = readFileSync(authPath, 'utf-8');
        const authData = JSON.parse(content);
        return authData.token || undefined;
    } catch {
        return undefined;
    }
}

/** Parse comma-separated protocol string: "x402,mpp" → ["x402", "mpp"] */
function parseProtocols(raw: string | undefined): Array<'x402' | 'mpp'> {
    if (!raw) return ['x402', 'mpp'];
    return raw
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter((p): p is 'x402' | 'mpp' => p === 'x402' || p === 'mpp');
}

/** Read a pricing env var (USD cents) and convert to fractional USD. */
function price(envVar: string, defaultCents: number): number {
    const raw = process.env[envVar];
    const cents = raw !== undefined ? Number(raw) : defaultCents;
    return cents / 100;
}

// ---------------------------------------------------------------------------
// Config / logging
// ---------------------------------------------------------------------------

log.setLevel(log.LEVELS.ERROR);

const argv = yargs(hideBin(process.argv))
    .wrap(null)
    .usage('Usage: $0 [options]')
    .env()
    .option('actors', {
        type: 'string',
        describe:
            'Comma-separated list of Actor full names to add to the server. '
            + 'Can also be set via ACTORS environment variable.',
    })
    .option('enable-adding-actors', {
        type: 'boolean',
        default: false,
        describe: 'Enable dynamically adding Actors as tools based on user requests.',
    })
    .option('enableActorAutoLoading', {
        type: 'boolean',
        default: false,
        hidden: true,
        describe: 'Deprecated: Use tools add-actor instead.',
    })
    .options('tools', {
        type: 'string',
        describe:
            'Comma-separated list of tools to enable (categories, specific tools, or Actors). '
            + 'Can also be set via TOOLS environment variable.',
    })
    .option('telemetry-enabled', {
        type: 'boolean',
        default: true,
        describe: 'Enable or disable telemetry tracking for tool calls.',
    })
    .option('telemetry-env', {
        type: 'string',
        choices: [TELEMETRY_ENV.PROD, TELEMETRY_ENV.DEV],
        default: DEFAULT_TELEMETRY_ENV,
        hidden: true,
        coerce: (arg: string) => arg?.toUpperCase(),
        describe: 'Telemetry environment when telemetry is enabled.',
    })
    .option('ui', {
        default: undefined,
        coerce: (arg: string | boolean | undefined) => {
            const normalized = arg === true || arg === '' ? 'true' : arg;
            return parseUiMode((normalized as string) || process.env.UI_MODE);
        },
        describe: 'UI mode for tool responses.',
    })
    .help('help')
    .alias('h', 'help')
    .version(false)
    .epilogue(
        'Payment-gated Apify MCP server. '
        + 'Set TOMOPAY_ADDRESS to your wallet/Stripe account to receive payments.
'
        + 'Powered by @tomopay/gateway — https://github.com/tomopay/gateway',
    )
    .parseSync() as CliArgs;

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------

const apifyToken = process.env.APIFY_TOKEN || getTokenFromAuthFile();
const tomopayAddress = process.env.TOMOPAY_ADDRESS;

if (!tomopayAddress) {
    log.error('TOMOPAY_ADDRESS is required but not set. Set it to your wallet address (x402) or Stripe account ID (MPP).');
    process.exit(1);
}

const enableAddingActors = Boolean(argv.enableAddingActors || argv.enableActorAutoLoading);
const actorList = argv.actors !== undefined ? parseCommaSeparatedList(argv.actors) : undefined;
const toolCategoryKeys = argv.tools !== undefined ? parseCommaSeparatedList(argv.tools) : undefined;

const originalError = log.error.bind(log);
log.error = (...args: Parameters<typeof log.error>) => {
    originalError(...args);
    // eslint-disable-next-line no-console
    console.error(...args);
};

const requiresAuthentication = isApiTokenRequired({
    toolCategoryKeys,
    actorList,
    enableAddingActors,
});

if (requiresAuthentication && !apifyToken) {
    log.error('APIFY_TOKEN is required but not set in the environment variables or in ~/.apify/auth.json');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Payment config
// ---------------------------------------------------------------------------

/**
 * Tool-level pricing for Apify operations.
 *
 * Apify charges per compute unit for Actor runs; downstream operators can
 * pass this cost through to agents (plus margin) using these defaults.
 *
 * Tool name → USD amount mapping. Globs are supported by @tomopay/gateway:
 *   - "call-actor" / "run-actor" → $0.10 (Actor execution — highest cost)
 *   - "search-actors"            → $0.05 (search query with ranking)
 *   - "fetch-actor-details"      → $0.05 (detail fetch from Apify API)
 *   - "get-actor-run"            → $0.01 (status poll)
 *   - "get-actor-output"         → $0.01 (read result dataset)
 *   - "get-dataset*"             → $0.01 (storage reads)
 *   - "get-key-value-store*"     → $0.01 (storage reads)
 *   - "search-apify-docs"        → $0.01 (docs search)
 *   - "fetch-apify-docs"         → $0.01 (docs fetch)
 *   - default (catch-all)        → $0.01 (any tool not listed above)
 */
const toolPricing: Record<string, { amount: number; currency: string }> = {
    // Actor execution — most expensive (Apify charges CUs per run)
    'call-actor': { amount: price('TOMOPAY_PRICE_RUN_ACTOR', 10), currency: 'USD' },
    'run-actor': { amount: price('TOMOPAY_PRICE_RUN_ACTOR', 10), currency: 'USD' },

    // Search & discovery — moderate cost
    'search-actors': { amount: price('TOMOPAY_PRICE_SEARCH', 5), currency: 'USD' },
    'fetch-actor-details': { amount: price('TOMOPAY_PRICE_DETAILS', 5), currency: 'USD' },

    // Run status & results reads — low cost
    'get-actor-run': { amount: price('TOMOPAY_PRICE_RUN_STATUS', 1), currency: 'USD' },
    'get-actor-output': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'abort-actor-run': { amount: price('TOMOPAY_PRICE_RUN_STATUS', 1), currency: 'USD' },
    'get-actor-run-log': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },

    // Storage reads — low cost
    'get-dataset': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-dataset-items': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-dataset-schema': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-key-value-store': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-key-value-store-keys': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-key-value-store-record': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-user-datasets-list': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-user-key-value-stores-list': { amount: price('TOMOPAY_PRICE_STORAGE', 1), currency: 'USD' },
    'get-user-runs-list': { amount: price('TOMOPAY_PRICE_RUN_STATUS', 1), currency: 'USD' },

    // Docs — low cost
    'search-apify-docs': { amount: price('TOMOPAY_PRICE_DOCS', 1), currency: 'USD' },
    'fetch-apify-docs': { amount: price('TOMOPAY_PRICE_DOCS', 1), currency: 'USD' },

    // Catch-all default for any unlisted tools (e.g. add-actor, custom scrapers)
    default: { amount: price('TOMOPAY_PRICE_DEFAULT', 1), currency: 'USD' },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const [major] = process.versions.node.split('.').map(Number);
    if (major < 18) {
        // eslint-disable-next-line no-console
        console.error(
            `Error: Apify MCP server requires Node.js 18 or later (you have ${process.version}).
`
            + 'Please update Node.js: https://nodejs.org',
        );
        process.exit(1);
    }

    // Build the base Apify MCP server
    const mcpServer = new ActorsMcpServer({
        transportType: 'stdio',
        telemetry: {
            enabled: argv.telemetryEnabled,
            env: getTelemetryEnv(argv.telemetryEnv),
        },
        token: apifyToken,
        uiMode: argv.ui,
        allowUnauthMode: !requiresAuthentication,
    });

    const input: Input = {
        actors: actorList,
        enableAddingActors,
        tools: toolCategoryKeys as ToolSelector[],
    };

    const normalizedInput = processInput(input);
    const apifyClient = new ApifyClient({ token: apifyToken });
    const tools = await loadToolsFromInput(normalizedInput, apifyClient, argv.ui ?? 'default');
    mcpServer.upsertTools(tools);

    // Wrap with Tomopay payment gating
    // withPayments() intercepts each tool call, collects payment via x402/MPP,
    // and only forwards to the underlying server once payment is confirmed.
    const protocols = parseProtocols(process.env.TOMOPAY_PROTOCOL);
    const { server: gatedServer } = withPayments(mcpServer, {
        payTo: tomopayAddress,
        protocols,
        pricing: toolPricing,
    });

    // Connect via stdio transport
    const transport = new StdioServerTransport();
    const mcpSessionId = randomUUID();

    const originalOnMessage = transport.onmessage;
    transport.onmessage = (message: JSONRPCMessage) => {
        const msgRecord = message as Record<string, unknown>;
        if (msgRecord.method === 'initialize') {
            (mcpServer.options as Record<string, unknown>).initializeRequestData = msgRecord as Record<string, unknown>;
        }
        const params = (msgRecord.params || {}) as ApifyRequestParams;
        params._meta ??= {};
        params._meta.mcpSessionId = mcpSessionId;
        msgRecord.params = params;

        if (originalOnMessage) {
            originalOnMessage(message);
        }
    };

    await gatedServer.connect(transport);

    log.info('Apify MCP server started with Tomopay payment gating', {
        protocols,
        payTo: tomopayAddress,
        toolCount: tools.length,
    });
}

main().catch(async (error) => {
    log.error('Server error', { error });
    const Sentry = await import('@sentry/node');
    Sentry.captureException(error);
    await Sentry.flush(5000);
    process.exit(1);
});
