import log from '@apify/log';

import { createApifyClientWithSkyfireSupport } from '../../apify_client.js';
import { HelperTools } from '../../const.js';
import { getWidgetConfig, WIDGET_URIS } from '../../resources/widgets.js';
import type { InternalToolArgs, ToolEntry } from '../../types.js';
import { logHttpError } from '../../utils/logging.js';
import { buildMCPResponse, buildUsageMeta } from '../../utils/mcp.js';
import {
    buildActorRunStructuredContent,
    CALL_ACTOR_EXAMPLES_SECTION,
    CALL_ACTOR_MCP_SERVER_SECTION,
    CALL_ACTOR_USAGE_SECTION,
    callActorAjvValidate,
    callActorInputSchema,
    callActorPreExecute,
    resolveAndValidateActor,
    waitForRunWithAbort,
} from '../core/call_actor_common.js';
import { actorRunOutputSchema } from '../structured_output_schemas.js';

const CALL_ACTOR_DEFAULT_DESCRIPTION = [
    `Call any Actor from the Apify Store.`,

    `WORKFLOW:
1. Use ${HelperTools.ACTOR_GET_DETAILS} to get the Actor's input schema
2. Call this tool with the actor name and proper input based on the schema

If the actor name is not in "username/name" format, use ${HelperTools.STORE_SEARCH} to resolve the correct Actor first.`,

    CALL_ACTOR_MCP_SERVER_SECTION,

    `IMPORTANT:
- This tool starts the Actor and returns immediately with run metadata (runId, status, storages).
- Use ${HelperTools.ACTOR_RUNS_GET} to wait for the Actor run to finish (supports waitSecs for bounded waiting).
- Once completed, use ${HelperTools.ACTOR_OUTPUT_GET} tool with the datasetId from storages to fetch full results.
- Use dedicated Actor tools when available for better experience`,

    CALL_ACTOR_USAGE_SECTION,

    CALL_ACTOR_EXAMPLES_SECTION,
].join('\n\n');

/**
 * Default mode call-actor tool.
 * Always starts the Actor and returns immediately with run metadata.
 * In MCP task mode (mcpTaskExecution), waits for completion before returning.
 */
export const defaultCallActor: ToolEntry = Object.freeze({
    type: 'internal',
    name: HelperTools.ACTOR_CALL,
    description: CALL_ACTOR_DEFAULT_DESCRIPTION,
    inputSchema: callActorInputSchema,
    outputSchema: actorRunOutputSchema,
    ajvValidate: callActorAjvValidate,
    requiresSkyfirePayId: true,
    // openai/* and ui keys are stripped in non-openai mode by stripWidgetMeta() in src/utils/tools.ts
    _meta: {
        ...getWidgetConfig(WIDGET_URIS.ACTOR_RUN)?.meta,
    },
    annotations: {
        title: 'Call Actor',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
    },
    execution: {
        // Support long-running tasks
        taskSupport: 'optional',
    },
    call: async (toolArgs: InternalToolArgs) => {
        const preResult = await callActorPreExecute(toolArgs);
        if ('earlyResponse' in preResult) {
            return preResult.earlyResponse;
        }

        const { parsed, baseActorName } = preResult;
        const { input, callOptions } = parsed;

        try {
            const resolution = await resolveAndValidateActor({
                actorName: baseActorName,
                input: input as Record<string, unknown>,
                toolArgs,
            });
            if ('error' in resolution) {
                return resolution.error;
            }

            const apifyClient = createApifyClientWithSkyfireSupport(toolArgs.apifyMcpServer, toolArgs.args, toolArgs.apifyToken);

            // Start the Actor run
            const actorRun = await apifyClient.actor(baseActorName).start(input, callOptions);

            log.debug('Started Actor run', { actorName: baseActorName, runId: actorRun.id, mcpSessionId: toolArgs.mcpSessionId });

            // In task mode, wait for the run to finish before returning.
            // The MCP task framework keeps the task "working" while this promise is pending.
            if (toolArgs.mcpTaskExecution) {
                if (toolArgs.progressTracker) {
                    toolArgs.progressTracker.startActorRunUpdates(actorRun.id, apifyClient, baseActorName);
                }

                const completedRun = await waitForRunWithAbort({
                    runId: actorRun.id,
                    apifyClient,
                    abortSignal: toolArgs.extra.signal,
                });

                if (!completedRun) {
                    log.info('Actor run aborted by client', { actorName: baseActorName, mcpSessionId: toolArgs.mcpSessionId });
                    return {};
                }

                const structuredContent = buildActorRunStructuredContent({ run: completedRun, actorName: baseActorName });
                const _meta = buildUsageMeta(completedRun);
                return {
                    content: [{
                        type: 'text',
                        text: `Actor "${baseActorName}" run ${completedRun.id} finished with status: ${completedRun.status}. ${structuredContent.hint}`,
                    }],
                    structuredContent,
                    ...(_meta && { _meta }),
                };
            }

            // Non-task mode: return immediately with run metadata
            const structuredContent = buildActorRunStructuredContent({ run: actorRun, actorName: baseActorName });
            return {
                content: [{
                    type: 'text',
                    text: `Started Actor "${baseActorName}" (Run ID: ${actorRun.id}). ${structuredContent.hint}`,
                }],
                structuredContent,
            };
        } catch (error) {
            logHttpError(error, 'Failed to call Actor', { actorName: baseActorName });
            return buildMCPResponse({
                texts: [`Failed to call Actor '${baseActorName}': ${error instanceof Error ? error.message : String(error)}.
Please verify the Actor name, input parameters, and ensure the Actor exists.
You can search for available Actors using the tool: ${HelperTools.STORE_SEARCH}, or get Actor details using: ${HelperTools.ACTOR_GET_DETAILS}.`],
                isError: true,
            });
        }
    },
} as const);
