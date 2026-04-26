// Transport-agnostic tool registry. Both the stdio entrypoint (src/index.ts)
// and the HTTP transport (src/http.ts) import from here. Adding a new tool
// only requires touching this file plus the implementation under ./tools.

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { FindMeClient } from './client.js';
import { type Elicitor, noopElicitor } from './elicit.js';
import { ToolError } from './errors.js';
import type { ToolResult } from './tool-helpers.js';

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

// Order matters in `tools/list` responses — upload tools first since they're
// the primary photographer workflow.
export const TOOL_DEFINITIONS: Tool[] = [
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

/**
 * Tools that depend on local filesystem access (Node `fs`). HTTP transports
 * should filter these out since the calling AI runs in a browser sandbox.
 */
export const LOCAL_ONLY_TOOL_NAMES = new Set<string>([
  'upload_photos_from_paths',
]);

export function getRemoteSafeDefinitions(): Tool[] {
  return TOOL_DEFINITIONS.filter((t) => !LOCAL_ONLY_TOOL_NAMES.has(t.name));
}

/**
 * Single dispatch function used by both transports. Caller provides a
 * FindMeClient (configured with the per-session API key); we route to the
 * right tool implementation and return a `ToolResult`.
 */
export async function dispatchToolCall(
  client: FindMeClient,
  name: string,
  rawArgs: unknown,
  opts: { remoteOnly?: boolean; elicitor?: Elicitor } = {},
): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const elicitor = opts.elicitor ?? noopElicitor;

  if (opts.remoteOnly && LOCAL_ONLY_TOOL_NAMES.has(name)) {
    return new ToolError(
      'invalid_request',
      `Tool "${name}" is not available over the HTTP transport. It needs local filesystem access — run findme-mcp via stdio instead.`,
    ).toToolError();
  }

  try {
    switch (name) {
      case 'upload_photos_from_paths':
        return await runUploadPhotosFromPaths(client, uploadPhotosFromPathsSchema.parse(args));
      case 'upload_photos_from_urls':
        return await runUploadPhotosFromUrls(client, uploadPhotosFromUrlsSchema.parse(args));
      case 'upload_photos_from_drive_folder':
        return await runUploadPhotosFromDriveFolder(client, uploadPhotosFromDriveFolderSchema.parse(args));
      case 'create_event':
        return await runCreateEvent(client, createEventSchema.parse(args), elicitor);
      case 'list_events':
        return await runListEvents(client, listEventsSchema.parse(args));
      case 'get_event':
        return await runGetEvent(client, getEventSchema.parse(args));
      case 'update_event':
        return await runUpdateEvent(client, updateEventSchema.parse(args));
      case 'delete_event':
        return await runDeleteEvent(client, deleteEventSchema.parse(args));
      case 'restore_event':
        return await runRestoreEvent(client, restoreEventSchema.parse(args));
      case 'get_event_qr':
        return await runGetEventQr(client, getEventQrSchema.parse(args));
      case 'get_event_analytics':
        return await runGetEventAnalytics(client, getEventAnalyticsSchema.parse(args));
      case 'get_usage':
        return await runGetUsage(client);
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
}
