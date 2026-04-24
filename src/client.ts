// Thin REST client for the FindMe API v1. Handles auth, retries, structured errors.
// See SPEC §10 + §8 for endpoint contracts.

import { ToolError, fromApiError } from './errors.js';

const DEFAULT_BASE_URL = 'https://findme.photo/api/v1';
const USER_AGENT = `findme-mcp/${process.env.npm_package_version ?? '0.1.0'}`;

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Bypass JSON parsing — returns raw Response. Used for binary endpoints like /qr. */
  raw?: boolean;
}

export class FindMeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: ClientOptions) {
    if (!opts.apiKey) {
      throw new ToolError(
        'missing_api_key',
        'FINDME_API_KEY environment variable is not set.',
        {
          action: 'Generate an API key at https://findme.photo/settings/api and add it to your MCP config.',
          link: 'https://findme.photo/settings/api',
        },
      );
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'User-Agent': USER_AGENT,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new ToolError(
        'network_error',
        `Can't reach the FindMe API (${url.hostname}). Check your internet connection.`,
        { details: { message: err instanceof Error ? err.message : String(err) } },
      );
    }

    type ApiErrorBody = Parameters<typeof fromApiError>[1];

    if (opts.raw) {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({
          error: { code: 'internal_error', message: `HTTP ${res.status}` },
        }))) as ApiErrorBody;
        throw fromApiError(res.status, body);
      }
      return res as unknown as T;
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const body = (await res.json().catch(() => null)) as (ApiErrorBody & { data?: unknown }) | null;
    if (!res.ok) {
      throw fromApiError(res.status, body ?? { error: { code: 'internal_error', message: `HTTP ${res.status}` } });
    }
    return body as T;
  }

  /** Convenience: unwrap `{ data, meta }` envelope and return just `data`. */
  async requestData<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const body = await this.request<{ data: T }>(path, opts);
    return body.data;
  }

  /** Convenience: unwrap a list response, returning items + pagination meta. */
  async requestList<T = unknown>(
    path: string,
    opts: RequestOptions = {},
  ): Promise<{ items: T[]; nextCursor: string | null; hasMore: boolean }> {
    const body = await this.request<{ data: T[]; meta: { next_cursor?: string; has_more: boolean } }>(path, opts);
    return {
      items: body.data,
      nextCursor: body.meta?.next_cursor ?? null,
      hasMore: body.meta?.has_more ?? false,
    };
  }
}
