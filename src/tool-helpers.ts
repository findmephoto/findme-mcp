// Helpers shared across tool implementations.

import { ToolError } from './errors.js';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

/** Wrap an async tool handler so thrown ToolErrors are returned as structured tool errors. */
export async function safeToolHandler<T>(
  handler: () => Promise<T>,
  format: (result: T) => ToolResult,
): Promise<ToolResult> {
  try {
    const result = await handler();
    return format(result);
  } catch (err) {
    if (err instanceof ToolError) {
      return err.toToolError();
    }
    return new ToolError(
      'internal_error',
      err instanceof Error ? err.message : String(err),
    ).toToolError();
  }
}

/** Return a plain text tool result. */
export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

/** Return a JSON-stringified tool result. AIs parse this fine. */
export function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
