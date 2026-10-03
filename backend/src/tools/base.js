import { z } from 'zod';

/**
 * Tool definition factory.
 *
 * A tool is: name, description, input schema (zod), required permissions,
 * an optional dangerous flag (forces user confirmation) and execute().
 */
export function defineTool(def) {
  return {
    source: def.source || 'builtin',
    pluginId: def.pluginId || null,
    name: def.name,
    description: def.description,
    permissions: def.permissions || [],
    dangerous: Boolean(def.dangerous),
    schema: def.schema || z.object({}),
    execute: def.execute,
    /** OpenAI-style function definition passed to providers. */
    toFunctionDef() {
      return {
        type: 'function',
        function: {
          name: this.name,
          description: this.description,
          parameters: z.toJSONSchema(this.schema, { target: 'openapi-3.1' }),
        },
      };
    },
  };
}

/** Truncate long tool output before it goes back into model context. */
export function cap(text, max = 12000) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

export function toolResult(summary, data) {
  return { summary: String(summary), data };
}
