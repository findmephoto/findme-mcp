// Tool: get_usage — current-period API + storage + event counts

import { z } from 'zod';

import type { FindMeClient } from '../client.js';
import { jsonResult, safeToolHandler, type ToolResult } from '../tool-helpers.js';

export const getUsageSchema = z.object({});

export const getUsageDefinition = {
  name: 'get_usage',
  description:
    'Get the current-month usage for your FindMe account: API requests used/limit, rate limit per minute, storage used/limit, and active event count. Use when the photographer asks about their usage, quota, remaining requests, or plan limits.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    additionalProperties: false,
  },
};

export async function runGetUsage(client: FindMeClient): Promise<ToolResult> {
  return safeToolHandler(
    async () => {
      interface Usage {
        period: { start: string; end: string };
        api: { requests_used: number; requests_limit: number | null; rate_limit_per_minute: number };
        storage: { used_bytes: number; limit_bytes: number };
        events: { active: number; limit: number | null };
      }
      return client.requestData<Usage>('/me/usage');
    },
    (data) => {
      const storageUsedGB = (data.storage.used_bytes / 1024 / 1024 / 1024).toFixed(2);
      const storageLimitGB = (data.storage.limit_bytes / 1024 / 1024 / 1024).toFixed(0);
      const apiLimit = data.api.requests_limit === null ? 'unlimited' : data.api.requests_limit.toLocaleString();
      const eventLimit = data.events.limit === null ? 'unlimited' : data.events.limit.toString();

      return jsonResult({
        period: data.period,
        api_requests: `${data.api.requests_used.toLocaleString()} / ${apiLimit}`,
        rate_limit: `${data.api.rate_limit_per_minute} requests/minute`,
        storage: `${storageUsedGB} GB / ${storageLimitGB} GB`,
        events: `${data.events.active} / ${eventLimit}`,
        raw: data,
      });
    },
  );
}
