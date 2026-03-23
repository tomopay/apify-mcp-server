import { z } from 'zod';

import log from '@apify/log';

import type { ApifyClient } from '../../apify_client.js';
import { HelperTools, TOOL_STATUS } from '../../const.js';
import { getWidgetConfig, WIDGET_URIS } from '../../resources/widgets.js';
import type { HelperTool, ToolInputSchema } from '../../types.js';
import { compileSchema } from '../../utils/ajv.js';
import { buildMCPResponse } from '../../utils/mcp.js';
import { actorRunOutputSchema } from '../structured_output_schemas.js';
import { getRunStatusHint } from './call_actor_common.js';

/**
 * Zod schema for get-actor-run arguments — shared between default and openai variants.
 */
export const getActorRunArgs = z.object({
    runId: z.string()
        .min(1)
        .describe('The ID of the Actor run.'),
    waitSecs: z.number()
        .int()
        .min(0)
        .max(60)
        .default(10)
        .describe(
            'Maximum seconds to wait for the Actor run to finish (default 10, max 60).'
            + ' The server polls the run at short intervals and returns immediately when a terminal state is reached.',
        ),
});

const GET_ACTOR_RUN_DESCRIPTION = `Get detailed information about a specific Actor run by runId.
The results will include run metadata (status, timestamps), performance stats, and storage IDs (datasetId, keyValueStoreId).

Supports bounded waiting via the \`waitSecs\` parameter (default: 10s, max: 60s). The server polls the run and returns as soon as a terminal state is reached or the wait time expires.

CRITICAL WARNING: NEVER call this tool immediately after call-actor in UI mode. The call-actor response includes a widget that automatically polls for updates. Calling this tool after call-actor is FORBIDDEN and unnecessary.

USAGE:
- Use to wait for an Actor run to finish after calling call-actor.
- Use when user explicitly asks about a specific run's status or details.
- Pass \`waitSecs: 0\` for an instant status check without waiting.

USAGE EXAMPLES:
- user_input: Show details of run y2h7sK3Wc (where y2h7sK3Wc is an existing run)
- user_input: What is the datasetId for run y2h7sK3Wc?`;

/**
 * Shared tool metadata for get-actor-run — everything except the `call` handler.
 * Used by both default and openai variants.
 */
export const getActorRunMetadata: Omit<HelperTool, 'call'> = {
    type: 'internal',
    name: HelperTools.ACTOR_RUNS_GET,
    description: GET_ACTOR_RUN_DESCRIPTION,
    inputSchema: z.toJSONSchema(getActorRunArgs) as ToolInputSchema,
    outputSchema: actorRunOutputSchema,
    ajvValidate: compileSchema({ ...z.toJSONSchema(getActorRunArgs), additionalProperties: true }),
    requiresSkyfirePayId: true,
    // openai/* and ui keys are stripped in non-openai mode by stripWidgetMeta() in src/utils/tools.ts
    _meta: {
        ...getWidgetConfig(WIDGET_URIS.ACTOR_RUN)?.meta,
    },
    annotations: {
        title: 'Get Actor run',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
    },
};

/**
 * Structured content returned from fetching actor run data.
 */
export type ActorRunStructuredContent = {
    runId: string;
    actorName?: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    stats?: unknown;
    storages: {
        defaultDatasetId: string;
        defaultKeyValueStoreId: string;
    };
    hint: string;
};

/**
 * Result of fetching actor run data — shared between both variants.
 */
export type FetchActorRunResult = {
    run: Record<string, unknown>;
    structuredContent: ActorRunStructuredContent;
};

/**
 * Fetches actor run data with optional bounded waiting, resolves actor name.
 * Returns the run data and structured content, or an early error response.
 */
export async function fetchActorRunData(params: {
    runId: string;
    client: ApifyClient;
    waitSecs?: number;
    mcpSessionId?: string;
}): Promise<{ error: object } | { result: FetchActorRunResult }> {
    const { runId, client, waitSecs = 10, mcpSessionId } = params;

    // waitSecs: 0 means instant check; otherwise use waitForFinish with bounded wait
    const run = waitSecs === 0
        ? await client.run(runId).get()
        : await client.run(runId).waitForFinish({ waitSecs });

    if (!run) {
        return {
            error: buildMCPResponse({
                texts: [`Run with ID '${runId}' not found.`],
                isError: true,
                toolStatus: TOOL_STATUS.SOFT_FAIL,
            }),
        };
    }

    log.debug('Get actor run', { runId, status: run.status, mcpSessionId });

    let actorName: string | undefined;
    if (run.actId) {
        try {
            const actor = await client.actor(run.actId).get();
            if (actor) {
                actorName = `${actor.username}/${actor.name}`;
            }
        } catch (error) {
            log.warning(`Failed to fetch actor name for run ${runId}`, { mcpSessionId, error });
        }
    }

    const structuredContent: ActorRunStructuredContent = {
        runId: run.id,
        actorName,
        status: run.status,
        startedAt: run.startedAt?.toISOString() || '',
        ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
        ...(run.stats ? { stats: run.stats } : {}),
        storages: {
            defaultDatasetId: run.defaultDatasetId,
            defaultKeyValueStoreId: run.defaultKeyValueStoreId,
        },
        hint: getRunStatusHint(run.status),
    };

    return { result: { run: run as unknown as Record<string, unknown>, structuredContent } };
}
