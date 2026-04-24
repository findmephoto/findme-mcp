// Event CRUD tools: create, list, get, update, delete, restore

import { z } from 'zod';

import type { FindMeClient } from '../client.js';
import { jsonResult, safeToolHandler, textResult, type ToolResult } from '../tool-helpers.js';

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

export const createEventSchema = z.object({
  name: z.string().min(1).max(200),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(2000).optional(),
  tag: z.string().max(80).optional(),
});

export const createEventDefinition = {
  name: 'create_event',
  description:
    'Create a new FindMe event (a wedding/photo gallery). Returns the event id, a shareable access code, and gallery + QR URLs. Use when the photographer says things like "create an event for Sarah & Mike on April 22" or "make a new gallery called Johnson Wedding".',
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'Event name, e.g. "Sarah & Mike Wedding"' },
      event_date: { type: 'string', description: 'Event date in YYYY-MM-DD format. Optional.' },
      description: { type: 'string', description: 'Optional description.' },
      tag: { type: 'string', description: 'Optional tag/category (e.g. "wedding", "corporate").' },
    },
    required: ['name'],
    additionalProperties: false,
  },
};

export async function runCreateEvent(
  client: FindMeClient,
  input: z.infer<typeof createEventSchema>,
): Promise<ToolResult> {
  return safeToolHandler(
    () =>
      client.requestData<EventResource>('/events', {
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
});

export const updateEventDefinition = {
  name: 'update_event',
  description:
    'Update fields on an existing event: name, event_date, description, tag, or access_code. Only include the fields you want to change. Use when the photographer wants to rename, re-date, or re-code a gallery.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      event_id: { type: 'string' },
      name: { type: 'string' },
      event_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null to clear' },
      description: { type: ['string', 'null'] },
      tag: { type: ['string', 'null'] },
      access_code: { type: 'string', description: '4-12 uppercase alphanumeric characters' },
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
    (id) => textResult(`Event ${id} deleted. You have 7 days to restore it with restore_event.`),
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
