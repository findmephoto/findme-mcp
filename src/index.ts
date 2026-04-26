#!/usr/bin/env node
// FindMe Photo MCP server — stdio transport entrypoint
// Run with: FINDME_API_KEY=fm_live_... npx findme-mcp

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { FindMeClient } from './client.js';
import { makeElicitor } from './elicit.js';
import { dispatchToolCall, TOOL_DEFINITIONS } from './registry.js';

const PACKAGE_VERSION = '0.2.0';

function main(): void {
  const apiKey = process.env.FINDME_API_KEY ?? '';
  const baseUrl = process.env.FINDME_API_BASE_URL;

  // Lazy client — defer the missing-key check to first tool call so the
  // MCP server still lists tools in the AI client's UI.
  let client: FindMeClient | null = null;
  const getClient = (): FindMeClient => {
    if (client) return client;
    client = new FindMeClient({ apiKey, baseUrl });
    return client;
  };

  const server = new Server(
    { name: 'findme-mcp', version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // stdio is fully bidirectional → elicitation requests can round-trip.
  const elicitor = makeElicitor(server, true);

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const result = await dispatchToolCall(
      getClient(),
      request.params.name,
      request.params.arguments,
      { elicitor },
    );
    return result as unknown as CallToolResult;
  });

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('[findme-mcp] fatal transport error:', err);
    process.exit(1);
  });

  console.error(`[findme-mcp] v${PACKAGE_VERSION} ready (${TOOL_DEFINITIONS.length} tools)`);
}

main();
