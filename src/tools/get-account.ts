// Tool: get_account_info — identity + Drive connection summary.
//
// The MCP host (Claude.ai, ChatGPT, Cursor) holds an OAuth token bound to
// one specific FindMe user. The same photographer can have multiple FindMe
// accounts (personal vs. studio email, for example) and multiple Google
// accounts (one for AI, one for Drive). Without a check, the AI happily
// operates on whatever account the token was minted against, which is the
// single most common source of "wait, that's not my account" confusion.
//
// This tool returns enough context for the model to confirm in one line:
//   "Connected to FindMe as info@venturesuccessusa.com (Free+) with Drive
//    at info@venturesuccessusa.com. 12 events. ✓"
//
// The server-level `instructions` field (see registry.ts) tells the model
// to call this at the start of any session that touches photos, events,
// uploads, or Drive imports.

import { z } from 'zod';

import type { FindMeClient } from '../client.js';
import { jsonResult, safeToolHandler, type ToolResult } from '../tool-helpers.js';

export const getAccountInfoSchema = z.object({});

export const getAccountInfoDefinition = {
  name: 'get_account_info',
  description:
    'Confirm which FindMe account and Google Drive connection this MCP session is operating on. Returns the FindMe email, plan tier, active event count, and the Google email that Drive is connected with (or null if not connected). ALWAYS call this once at the start of any conversation that involves listing events, uploading photos, importing from Drive, or any account-scoped action — and surface the result to the photographer in one short sentence so they can confirm or correct before any action is taken. If the FindMe email and the Drive Google email differ, name both explicitly. If Drive is not connected and the user asks to import, point them at https://findme.photo/profile to connect it.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  },
};

interface AccountInfo {
  findme: {
    user_id: string;
    email: string;
    display_name: string | null;
    tier: string;
    tier_display_name: string;
    events_count: number;
  };
  drive: {
    connected: boolean;
    google_email?: string;
    connected_at?: string;
    last_used_at?: string | null;
    tier_allows_drive: boolean;
  };
  accounts_match: boolean | null;
  hint: string | null;
}

export async function runGetAccountInfo(client: FindMeClient): Promise<ToolResult> {
  return safeToolHandler(
    () => client.requestData<AccountInfo>('/me/account'),
    (data) => {
      const findmeLine = `${data.findme.email} (${data.findme.tier_display_name})`;
      const driveLine = data.drive.connected
        ? `Drive: ${data.drive.google_email}`
        : data.drive.tier_allows_drive
          ? 'Drive: not connected (connect at https://findme.photo/profile)'
          : 'Drive: not available on this tier';
      const matchLine =
        data.accounts_match === false
          ? ` ⚠ FindMe account and Drive account differ — imports will only see folders the Drive account can access.`
          : '';
      const summary = `Connected to FindMe as ${findmeLine}. ${driveLine}. ${data.findme.events_count} events.${matchLine}`;

      return jsonResult({
        summary,
        findme: data.findme,
        drive: data.drive,
        accounts_match: data.accounts_match,
        hint: data.hint,
      });
    },
  );
}
