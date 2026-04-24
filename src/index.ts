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
import { ToolError } from './errors.js';

import {
  createEventDefinition, createEventSchema, runCreateEvent,
  listEventsDefinition, listEventsSchema, runListEvents,
  getEventDefinition, getEventSchema, runGetEvent,
  updateEventDefinition, updateEventSchema, runUpdateEvent,
  deleteEventDefinition, deleteEventSchema, runDeleteEvent,
  restoreEventDefinition, restoreEventSchema, runRestoreEvent,
  getEventQrDefinition, getEventQrSchema, runGetEventQr,
  getEventAnalyticsDefinition, getEventAnalyticsSchema, runGetEventAnalytics,
} from './tools/events-crud.js';
import {
  getUsageDefinition, runGetUsage,
} from './tools/get-usage.js';
import {
  uploadPhotosFromPathsDefinition, uploadPhotosFromPathsSchema, runUploadPhotosFromPaths,
  uploadPhotosFromUrlsDefinition, uploadPhotosFromUrlsSchema, runUploadPhotosFromUrls,
  uploadPhotosFromDriveFolderDefinition, uploadPhotosFromDriveFolderSchema, runUploadPhotosFromDriveFolder,
} from './tools/upload.js';

const PACKAGE_VERSION = '0.1.0';

// Every tool the server exposes. Order matters in listings — upload tools first
// since that's the primary workflow.
const TOOL_DEFINITIONS = [
  uploadPhotosFromPathsDefinition,
  uploadPhotosFromUrlsDefinition,
  uploadPhotosFromDriveFolderDefinition,
  createEventDefinition,
  listEventsDefinition,
  getEventDefinition,
  updateEventDefinition,
  deleteEventDefinition,
  restoreEventDefinition,
  getEventQrDefinition,
  getEventAnalyticsDefinition,
  getUsageDefinition,
];

function main(): void {
  const apiKey = process.env.FINDME_API_KEY ?? '';
  const baseUrl = process.env.FINDME_API_BASE_URL; // optional override for staging/dev

  // Lazy client — we don't want to crash on startup if the key is missing;
  // instead, the first tool call surfaces a `missing_api_key` error via ToolError.
  // This way the MCP server still lists tools in the AI client UI.
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

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};

    const result = await (async () => {
      try {
        switch (name) {
          case 'upload_photos_from_paths':
            return await runUploadPhotosFromPaths(getClient(), uploadPhotosFromPathsSchema.parse(args));
          case 'upload_photos_from_urls':
            return await runUploadPhotosFromUrls(getClient(), uploadPhotosFromUrlsSchema.parse(args));
          case 'upload_photos_from_drive_folder':
            return await runUploadPhotosFromDriveFolder(getClient(), uploadPhotosFromDriveFolderSchema.parse(args));
          case 'create_event':
            return await runCreateEvent(getClient(), createEventSchema.parse(args));
          case 'list_events':
            return await runListEvents(getClient(), listEventsSchema.parse(args));
          case 'get_event':
            return await runGetEvent(getClient(), getEventSchema.parse(args));
          case 'update_event':
            return await runUpdateEvent(getClient(), updateEventSchema.parse(args));
          case 'delete_event':
            return await runDeleteEvent(getClient(), deleteEventSchema.parse(args));
          case 'restore_event':
            return await runRestoreEvent(getClient(), restoreEventSchema.parse(args));
          case 'get_event_qr':
            return await runGetEventQr(getClient(), getEventQrSchema.parse(args));
          case 'get_event_analytics':
            return await runGetEventAnalytics(getClient(), getEventAnalyticsSchema.parse(args));
          case 'get_usage':
            return await runGetUsage(getClient());
          default:
            return new ToolError('invalid_request', `Unknown tool: ${name}`).toToolError();
        }
      } catch (err) {
        if (err instanceof ToolError) return err.toToolError();
        return new ToolError(
          'invalid_request',
          err instanceof Error ? err.message : String(err),
        ).toToolError();
      }
    })();

    // ToolResult is structurally compatible with CallToolResult but TypeScript
    // can't narrow the SDK's union (which includes a `task` streaming variant).
    return result as unknown as CallToolResult;
  });

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('[findme-mcp] fatal transport error:', err);
    process.exit(1);
  });

  // Log startup only to stderr so it doesn't corrupt the stdio protocol.
  console.error(`[findme-mcp] v${PACKAGE_VERSION} ready (${TOOL_DEFINITIONS.length} tools)`);
}

main();
