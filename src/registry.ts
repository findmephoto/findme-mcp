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
  getUploadLinkDefinition, getUploadLinkSchema, runGetUploadLink,
} from './tools/events-crud.js';
import {
  getAccountInfoDefinition, runGetAccountInfo,
} from './tools/get-account.js';
import {
  getUsageDefinition, runGetUsage,
} from './tools/get-usage.js';
import {
  uploadPhotosFromPathsDefinition, uploadPhotosFromPathsSchema, runUploadPhotosFromPaths,
  uploadPhotosFromUrlsDefinition, uploadPhotosFromUrlsSchema, runUploadPhotosFromUrls,
  uploadPhotosFromDriveFolderDefinition, uploadPhotosFromDriveFolderSchema, runUploadPhotosFromDriveFolder,
} from './tools/upload.js';

// Order matters in `tools/list` responses — get_account_info first so the
// model sees it before the action tools, then uploads as the primary
// photographer workflow.
export const TOOL_DEFINITIONS: Tool[] = [
  getAccountInfoDefinition,
  getUploadLinkDefinition,
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
 * Server-level instructions surfaced to the AI in the `initialize` response.
 * MCP-compliant clients (Claude.ai, Claude Desktop, ChatGPT, Cursor) include
 * this in the model's system prompt for the session.
 *
 * Goal: get the model to call get_account_info once before any account-scoped
 * action, so the photographer can confirm or correct the active account
 * before anything is created/uploaded/imported.
 */
export const SERVER_INSTRUCTIONS = `FindMe Photo MCP — wedding gallery operations.

CRITICAL FIRST STEP: Before listing events, creating events, uploading photos, or starting Drive imports, call get_account_info ONCE per session and surface the result to the photographer in one short line, e.g.:

  "Connected to FindMe as info@studio.com (Free+) with Drive at info@studio.com. 12 events. ✓"

This removes ambiguity for photographers who have multiple FindMe accounts (personal vs. studio) or multiple Google accounts (one for the AI, one for Drive). If the FindMe account email and the Drive Google email are different, name BOTH explicitly so the photographer can confirm or course-correct before action.

If accounts_match is false and the photographer asks to import from Drive, warn them: "Drive imports will only see folders that <drive_email> has access to. If your photos are in a different Google account, share the folder with <drive_email> or reconnect Drive at https://findme.photo/profile."

UPLOADING PHOTOS: You usually cannot read the photographer's local files (you can only when running as a locally-installed Claude Desktop with the filesystem tool). So in ChatGPT and Claude web/mobile, do NOT ask for file paths — call get_upload_link and give the photographer the link to tap and pick their photos in the browser. Only use upload_photos_from_paths when you actually have local filesystem access.

Voice: playful, confident, specific. Cite real numbers from tool responses. Don't hedge.`;

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
      case 'get_account_info':
        return await runGetAccountInfo(client);
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
      case 'get_upload_link':
        return await runGetUploadLink(client, getUploadLinkSchema.parse(args));
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
