// Elicitation helper. Wraps `server.elicitInput()` so tool implementations can
// request structured input from the user mid-call (e.g. "pick album quality"
// rendered as radio buttons in Claude Desktop). Hosts that don't support
// form-mode elicitation get a no-op; tools must check `supportsForm()` and
// fall back to a regular JSON `needs_input` payload.

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export type ElicitContent = Record<string, string | number | boolean | string[]>;

export interface ElicitFormResult {
  action: 'accept' | 'decline' | 'cancel';
  content?: ElicitContent;
}

export interface ElicitFormParams {
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface Elicitor {
  /** True if both the transport and the connected client support form elicitation. */
  supportsForm(): boolean;
  /** Issue an `elicitation/create` request and return the user's response. */
  elicit(params: ElicitFormParams): Promise<ElicitFormResult>;
}

/**
 * Build an Elicitor backed by a live Server instance. `transportBidirectional`
 * must be true for transports that can carry server→client requests after
 * `tools/call` has started — stdio always can; HTTP only when streaming/SSE
 * is on (not when `enableJsonResponse: true`).
 */
export function makeElicitor(server: Server, transportBidirectional: boolean): Elicitor {
  return {
    supportsForm() {
      if (!transportBidirectional) return false;
      const caps = server.getClientCapabilities();
      return Boolean(caps?.elicitation?.form);
    },
    async elicit(params) {
      const result = await server.elicitInput({
        mode: 'form',
        message: params.message,
        // Cast: the SDK's discriminated form schema is structurally compatible
        // with the slimmer subset we use here (string/enum, boolean primitives).
        requestedSchema: params.requestedSchema as never,
      });
      return {
        action: result.action,
        content: result.content as ElicitContent | undefined,
      };
    },
  };
}

/** Returned to tools when the active transport can't carry elicitation requests. */
export const noopElicitor: Elicitor = {
  supportsForm: () => false,
  async elicit() {
    return { action: 'cancel' };
  },
};
