import type { HelperTool, ServerMode, ToolBase, ToolEntry, ToolInputSchema } from '../types.js';
import { fixZodSchemaRequired } from './ajv.js';

type ToolPublicFieldOptions = {
    mode?: ServerMode;
    filterWidgetMeta?: boolean;
};

/**
 * Strips widget-specific metadata (openai/* and ui keys) from tool metadata.
 * Used to hide widget metadata in non-openai modes.
 */
function stripWidgetMeta(meta?: ToolBase['_meta']) {
    if (!meta) return meta;

    const filteredEntries = Object.entries(meta)
        .filter(([key]) => !key.startsWith('openai/') && key !== 'ui' && key !== 'ui/resourceUri');

    if (filteredEntries.length === 0) return undefined;

    return Object.fromEntries(filteredEntries);
}

/**
 * Zod 4's z.toJSONSchema() lists properties with `.default()` in `required`.
 * Clients treat that as mandatory arguments; strip them before tools/list.
 */
function fixZodInputSchemaRequired(inputSchema: ToolBase['inputSchema']): ToolBase['inputSchema'] {
    if (!inputSchema || typeof inputSchema !== 'object') return inputSchema;
    return fixZodSchemaRequired({ ...inputSchema } as Record<string, unknown>) as ToolInputSchema;
}

/**
 * Returns a public version of the tool containing only fields that should be exposed publicly.
 * Used for the tools list request.
 */
export function getToolPublicFieldOnly(tool: ToolBase, options: ToolPublicFieldOptions = {}) {
    const { mode, filterWidgetMeta = false } = options;
    const meta = filterWidgetMeta && mode !== 'openai'
        ? stripWidgetMeta(tool._meta)
        : tool._meta;

    return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: fixZodInputSchemaRequired(tool.inputSchema),
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
        icons: tool.icons,
        execution: tool.execution,
        _meta: meta,
    };
}

/**
 * Creates a deep copy of a tool entry, preserving functions like ajvValidate and call
 * while cloning all other properties to avoid shared state mutations.
 */
export function cloneToolEntry(toolEntry: ToolEntry): ToolEntry {
    // Store the original functions
    const originalAjvValidate = toolEntry.ajvValidate;
    const originalCall = toolEntry.type === 'internal' ? toolEntry.call : undefined;

    // Create a deep copy using JSON serialization (excluding functions)
    const cloned = JSON.parse(JSON.stringify(toolEntry, (key, value) => {
        if (key === 'ajvValidate' || key === 'call') return undefined;
        return value;
    })) as ToolEntry;

    // Restore the original functions
    cloned.ajvValidate = originalAjvValidate;
    if (toolEntry.type === 'internal' && originalCall) {
        (cloned as HelperTool).call = originalCall;
    }

    return cloned;
}
