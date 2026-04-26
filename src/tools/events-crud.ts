// Event CRUD tools: create, list, get, update, delete, restore

import { z } from 'zod';

import type { FindMeClient } from '../client.js';
import { type Elicitor, noopElicitor } from '../elicit.js';
import { jsonResult, safeToolHandler, type ToolResult } from '../tool-helpers.js';

// ──────────────────────────────────────────────────────────
// Shared
// ──────────────────────────────────────────────────────────

interface EventResource {
  id: string;
  name: string;
  access_code: string;
  event_date: string | null;
  description: string | null;
  tag: string | null;
  gallery_url: string;
  qr_url: string;
  created_at: string;
  updated_at?: string;
  stats?: {
    photo_count: number;
    video_count: number;
    storage_bytes: number;
    guest_visits: number;
    selfie_searches: number;
  };
}

// ──────────────────────────────────────────────────────────
// create_event
// ──────────────────────────────────────────────────────────

const ALBUM_QUALITY_VALUES = ['800px', '3000px', '4000px', '15mb'] as const;

export const createEventSchema = z.object({
  name: z.string().min(1).max(200),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(2000).optional(),
  tag: z.string().max(80).optional(),
  album_quality: z.enum(ALBUM_QUALITY_VALUES).optional(),
  enable_downloads: z.boolean().optional(),
  is_collaborative: z.boolean().optional(),
});

export const createEventDefinition = {
  name: 'create_event',
  description:
    'Create a new FindMe event (a wedding/photo gallery). Returns the event id, a shareable access code, and gallery + QR URLs. Use when the photographer says things like "create an event for Sarah & Mike on April 22" or "make a new gallery called Johnson Wedding". CRITICAL — three album settings are user preferences: album_quality (storage resolution; tier-capped), enable_downloads (guest downloads on/off), is_collaborative (others can upload). DO NOT guess, infer, or fill in defaults for these three fields yourself — you have no way to know what the photographer prefers. On the FIRST call, omit all three of these fields (only pass name + optional date/description/tag). The tool will respond with either an interactive form (clients with elicitation support) or a structured needs_input JSON listing tier-allowed options and recommended defaults — surface those options to the photographer as a numbered multiple-choice list, never as an open-ended question, and wait for their answer. Only then call create_event again with the photographer\'s chosen values. The only exception: if the photographer explicitly states a preference in their initial message (e.g. "make it collaborative" or "use 4000px quality"), you may include those specific stated preferences. FindMe has a playful, confident voice — when the event is created, give a short upbeat reaction that names the gallery and its access code, and mention the album_quality (e.g. "stored at 4000px, your plan\'s top setting"). Do not use the same phrasing twice.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Event name, e.g. "Sarah & Mike Wedding"' },
      event_date: { type: 'string', description: 'Event date in YYYY-MM-DD format. Optional.' },
      description: { type: 'string', description: 'Optional description.' },
      tag: { type: 'string', description: 'Optional tag/category (e.g. "wedding", "corporate").' },
      album_quality: {
        type: 'string',
        enum: [...ALBUM_QUALITY_VALUES],
        description: 'Storage resolution. Tier-capped — call without this and the tool will return your allowed options.',
      },
      enable_downloads: {
        type: 'boolean',
        description: 'Whether guests can download photos from the gallery.',
      },
      is_collaborative: {
        type: 'boolean',
        description: 'Whether the album is shareable/collaborative — other people can upload photos to it.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

interface TierLimitsResponse {
  tier: string;
  display_name: string;
  max_album_quality: (typeof ALBUM_QUALITY_VALUES)[number];
  allowed_album_qualities: Array<(typeof ALBUM_QUALITY_VALUES)[number]>;
  max_albums: number | null;
}

export async function runCreateEvent(
  client: FindMeClient,
  input: z.infer<typeof createEventSchema>,
  elicitor: Elicitor = noopElicitor,
): Promise<ToolResult> {
  // If any of the 3 album settings is missing, ask the photographer.
  // Preferred path: server.elicitInput → host renders a native form with radio
  // buttons and toggles (deterministic UX, one click per answer).
  // Fallback path: return a `needs_input` JSON payload describing the
  // questions; the LLM relays them to the user as text.
  const missing: string[] = [];
  if (input.album_quality === undefined) missing.push('album_quality');
  if (input.enable_downloads === undefined) missing.push('enable_downloads');
  if (input.is_collaborative === undefined) missing.push('is_collaborative');

  if (missing.length === 0) {
    return persistEvent(client, input);
  }

  // Tier limits drive the album_quality option list either way. If the fetch
  // fails (auth, network, etc.) the dispatcher's catch block surfaces it as a
  // structured tool error.
  const limits = await client.requestData<TierLimitsResponse>('/me/tier_limits');

  if (elicitor.supportsForm()) {
    const elicited = await tryElicitMissing(elicitor, input, missing, limits);
    if (elicited.action === 'accept' && elicited.merged) {
      return persistEvent(client, elicited.merged);
    }
    if (elicited.action === 'decline' || elicited.action === 'cancel') {
      return jsonResult({
        cancelled: true,
        reason: elicited.action,
        message:
          elicited.action === 'decline'
            ? 'Photographer declined to provide the album settings. Ask them informally if they\'d like to proceed and what they prefer.'
            : 'Elicitation was cancelled before completion. No album was created.',
      });
    }
    // action === 'error' falls through to the JSON `needs_input` fallback
  }

  // Fallback: structured needs_input JSON the LLM can read out as a text question.
  return jsonResult({
    needs_input: true,
    message:
      'Before creating the album, ask the photographer for these settings. Present each as a numbered multiple-choice list — do not ask open-ended. The album_quality options are capped to their plan.',
    tier: limits.display_name,
    questions: buildQuestions(input, limits),
    next_action: 'Once you have the answers, call create_event again with name + the 3 settings filled in.',
  });
}

function buildQuestions(
  input: z.infer<typeof createEventSchema>,
  limits: TierLimitsResponse,
) {
  return [
    ...(input.album_quality === undefined
      ? [{
          field: 'album_quality',
          prompt: `What quality should photos be stored at? Your ${limits.display_name} plan caps at ${limits.max_album_quality}.`,
          options: limits.allowed_album_qualities,
          recommended: limits.max_album_quality,
        }]
      : []),
    ...(input.enable_downloads === undefined
      ? [{
          field: 'enable_downloads',
          prompt: 'Should guests be able to download photos from the gallery?',
          options: [true, false],
          recommended: true,
        }]
      : []),
    ...(input.is_collaborative === undefined
      ? [{
          field: 'is_collaborative',
          prompt: 'Should this be a collaborative album that other people can upload to?',
          options: [true, false],
          recommended: false,
        }]
      : []),
  ];
}

interface ElicitOutcome {
  action: 'accept' | 'decline' | 'cancel' | 'error';
  merged?: z.infer<typeof createEventSchema>;
}

async function tryElicitMissing(
  elicitor: Elicitor,
  input: z.infer<typeof createEventSchema>,
  missing: string[],
  limits: TierLimitsResponse,
): Promise<ElicitOutcome> {
  const properties: Record<string, unknown> = {};

  if (missing.includes('album_quality')) {
    properties.album_quality = {
      type: 'string',
      title: 'Album quality',
      description: `Storage resolution. Your ${limits.display_name} plan caps at ${limits.max_album_quality}.`,
      enum: limits.allowed_album_qualities,
      default: limits.max_album_quality,
    };
  }
  if (missing.includes('enable_downloads')) {
    properties.enable_downloads = {
      type: 'boolean',
      title: 'Allow guest downloads',
      description: 'Whether guests can download photos from the gallery.',
      default: true,
    };
  }
  if (missing.includes('is_collaborative')) {
    properties.is_collaborative = {
      type: 'boolean',
      title: 'Collaborative album',
      description: 'Whether other people can upload photos to this album.',
      default: false,
    };
  }

  try {
    const result = await elicitor.elicit({
      message: 'A few quick album settings before we create the gallery:',
      requestedSchema: {
        type: 'object',
        properties,
        required: missing,
      },
    });

    if (result.action !== 'accept' || !result.content) {
      return { action: result.action };
    }

    const answers = result.content;
    const merged: z.infer<typeof createEventSchema> = {
      ...input,
      ...(typeof answers.album_quality === 'string'
        ? { album_quality: answers.album_quality as typeof ALBUM_QUALITY_VALUES[number] }
        : {}),
      ...(typeof answers.enable_downloads === 'boolean'
        ? { enable_downloads: answers.enable_downloads }
        : {}),
      ...(typeof answers.is_collaborative === 'boolean'
        ? { is_collaborative: answers.is_collaborative }
        : {}),
    };

    return { action: 'accept', merged };
  } catch {
    return { action: 'error' };
  }
}

async function persistEvent(
  client: FindMeClient,
  input: z.infer<typeof createEventSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    () =>
      client.requestData<EventResource & {
        album_quality?: string;
        enable_downloads?: boolean;
        is_collaborative?: boolean;
      }>('/events', {
        method: 'POST',
        body: input,
      }),
    (data) =>
      jsonResult({
        id: data.id,
        name: data.name,
        access_code: data.access_code,
        gallery_url: data.gallery_url,
        event_date: data.event_date,
        album_quality: data.album_quality,
        enable_downloads: data.enable_downloads,
        is_collaborative: data.is_collaborative,
        created_at: data.created_at,
      }),
  );
}

// ──────────────────────────────────────────────────────────
// list_events
// ──────────────────────────────────────────────────────────

export const listEventsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  created_after: z.string().optional(),
});

export const listEventsDefinition = {
  name: 'list_events',
  description:
    'List the photographer\'s events, most recent first. Returns up to 20 by default; use `cursor` for pagination. Filter with `created_after` (ISO date) to only show recent events.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'integer', description: 'Max 100. Default 20.' },
      cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
      created_after: { type: 'string', description: 'ISO datetime. Only show events created after this.' },
    },
    additionalProperties: false,
  },
};

export async function runListEvents(
  client: FindMeClient,
  input: z.infer<typeof listEventsSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    () =>
      client.requestList<EventResource>('/events', {
        query: {
          limit: input.limit,
          cursor: input.cursor,
          created_after: input.created_after,
        },
      }),
    ({ items, nextCursor, hasMore }) =>
      jsonResult({
        events: items.map((e) => ({
          id: e.id,
          name: e.name,
          access_code: e.access_code,
          event_date: e.event_date,
          gallery_url: e.gallery_url,
          created_at: e.created_at,
        })),
        count: items.length,
        has_more: hasMore,
        next_cursor: nextCursor,
      }),
  );
}

// ──────────────────────────────────────────────────────────
// get_event
// ──────────────────────────────────────────────────────────

export const getEventSchema = z.object({
  event_id: z.string().uuid(),
});

export const getEventDefinition = {
  name: 'get_event',
  description:
    'Get full details for one event — includes stats: photo_count, video_count, total storage, guest visits, selfie searches. Use when the photographer asks about the status or stats of a specific gallery.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string', description: 'UUID of the event.' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
};

export async function runGetEvent(
  client: FindMeClient,
  input: z.infer<typeof getEventSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    () => client.requestData<EventResource>(`/events/${input.event_id}`),
    (data) => jsonResult(data),
  );
}

// ──────────────────────────────────────────────────────────
// update_event
// ──────────────────────────────────────────────────────────

export const updateEventSchema = z.object({
  event_id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  tag: z.string().max(80).nullable().optional(),
  access_code: z.string().regex(/^[A-Z0-9]{4,12}$/).optional(),
  album_quality: z.enum(ALBUM_QUALITY_VALUES).optional(),
  enable_downloads: z.boolean().optional(),
  is_collaborative: z.boolean().optional(),
});

export const updateEventDefinition = {
  name: 'update_event',
  description:
    'Update fields on an existing event: name, event_date, description, tag, access_code, album_quality (storage resolution; changeable only before the first photo is uploaded, and tier-capped), enable_downloads (toggle guest downloads on/off), or is_collaborative (toggle whether other people can upload). Only include the fields you want to change. Use when the photographer wants to rename, re-date, re-code, change quality (pre-upload), or flip the downloads/collaborative toggles. If the photographer asks to change album_quality on an album that already has photos, the API will return a `conflict` error — relay that politely and explain they\'d need to delete photos first.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
      name: { type: 'string' },
      event_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null to clear' },
      description: { type: ['string', 'null'] },
      tag: { type: ['string', 'null'] },
      access_code: { type: 'string', description: '4-12 uppercase alphanumeric characters' },
      album_quality: {
        type: 'string',
        enum: [...ALBUM_QUALITY_VALUES],
        description: 'Storage resolution. Changeable only before the first photo is uploaded; tier-capped.',
      },
      enable_downloads: { type: 'boolean', description: 'Whether guests can download photos.' },
      is_collaborative: { type: 'boolean', description: 'Whether other people can upload to this album.' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
};

export async function runUpdateEvent(
  client: FindMeClient,
  input: z.infer<typeof updateEventSchema>,
): Promise<ToolResult> {
  const { event_id, ...patch } = input;
  return safeToolHandler(
    () =>
      client.requestData<EventResource>(`/events/${event_id}`, {
        method: 'PATCH',
        body: patch,
      }),
    (data) => jsonResult(data),
  );
}

// ──────────────────────────────────────────────────────────
// delete_event
// ──────────────────────────────────────────────────────────

export const deleteEventSchema = z.object({
  event_id: z.string().uuid(),
});

export const deleteEventDefinition = {
  name: 'delete_event',
  description:
    'Soft-delete an event. The event is hidden immediately and photos stop appearing in the gallery, but the data is kept for 7 days so it can be restored with restore_event if needed. After 7 days, the data is permanently purged.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
};

export async function runDeleteEvent(
  client: FindMeClient,
  input: z.infer<typeof deleteEventSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    async () => {
      await client.request<undefined>(`/events/${input.event_id}`, { method: 'DELETE' });
      return input.event_id;
    },
    (id) =>
      jsonResult({
        deleted: true,
        event_id: id,
        recovery_window_days: 7,
        restore_tool: 'restore_event',
        note: 'Soft-delete complete. Gallery is hidden immediately. Photos and faces purge after 7 days unless restored.',
      }),
  );
}

// ──────────────────────────────────────────────────────────
// restore_event
// ──────────────────────────────────────────────────────────

export const restoreEventSchema = z.object({
  event_id: z.string().uuid(),
});

export const restoreEventDefinition = {
  name: 'restore_event',
  description:
    'Restore a soft-deleted event within the 7-day recovery window. Fails if the event is already active or past the 7-day cutoff.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
};

export async function runRestoreEvent(
  client: FindMeClient,
  input: z.infer<typeof restoreEventSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    () =>
      client.requestData<EventResource>(`/events/${input.event_id}/restore`, {
        method: 'POST',
      }),
    (data) => jsonResult({ restored: true, event: data }),
  );
}

// ──────────────────────────────────────────────────────────
// get_event_qr
// ──────────────────────────────────────────────────────────

export const getEventQrSchema = z.object({
  event_id: z.string().uuid(),
  size: z.number().int().min(128).max(2048).optional(),
});

export const getEventQrDefinition = {
  name: 'get_event_qr',
  description:
    'Get a QR code image (PNG) for an event\'s public gallery URL. Returns the image so the AI can display it to the photographer or save it. Useful for printing signage at events.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
      size: { type: 'integer', description: 'Pixel size per side (128-2048). Default 512.' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
};

export async function runGetEventQr(
  client: FindMeClient,
  input: z.infer<typeof getEventQrSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    async () => {
      const res = await client.request<Response>(`/events/${input.event_id}/qr`, {
        raw: true,
        query: { size: input.size },
      });
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString('base64');
    },
    (base64) => ({
      content: [
        { type: 'image' as const, data: base64, mimeType: 'image/png' },
        { type: 'text' as const, text: 'QR code ready. It points to the event\'s public gallery URL.' },
      ],
    }),
  );
}

// ──────────────────────────────────────────────────────────
// get_event_analytics
// ──────────────────────────────────────────────────────────

export const getEventAnalyticsSchema = z.object({
  event_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const getEventAnalyticsDefinition = {
  name: 'get_event_analytics',
  description:
    'Get aggregated analytics for an event: guest visits, unique visitors, photos downloaded, selfie searches, and per-day breakdown. Default window is event creation to now. Use when the photographer asks things like "how many people viewed the Johnson wedding?" or "what was the download count?"',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
      from: { type: 'string', description: 'YYYY-MM-DD start date' },
      to: { type: 'string', description: 'YYYY-MM-DD end date' },
    },
    required: ['event_id'],
    additionalProperties: false,
  },
};

export async function runGetEventAnalytics(
  client: FindMeClient,
  input: z.infer<typeof getEventAnalyticsSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    () =>
      client.requestData(`/events/${input.event_id}/analytics`, {
        query: { from: input.from, to: input.to },
      }),
    (data) => jsonResult(data),
  );
}
