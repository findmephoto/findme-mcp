// Structured tool errors per SPEC §10.6
// Every tool wraps thrown ToolError in the MCP error shape so AI clients
// get machine-readable codes instead of stack traces.

export type ErrorCode =
  | 'missing_api_key'
  | 'invalid_token'
  | 'tier_not_eligible'
  | 'upgrade_required'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'drive_not_connected'
  | 'not_found'
  | 'invalid_request'
  | 'internal_error'
  | 'network_error'
  | 'path_not_found'
  | 'no_supported_files'
  | 'permission_denied'
  | 'file_too_large'
  | 'upload_failed_partial'
  | 's3_put_failed'
  | 's3_object_missing';

export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly action?: string;
  readonly link?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { action?: string; link?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.action = opts.action;
    this.link = opts.link;
    this.details = opts.details;
  }

  /** Serialize to the text content an MCP tool returns when `isError: true`. */
  toToolError(): { isError: true; content: Array<{ type: 'text'; text: string }> } {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              code: this.code,
              message: this.message,
              ...(this.action ? { action: this.action } : {}),
              ...(this.link ? { link: this.link } : {}),
              ...(this.details ? { details: this.details } : {}),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

/** Map a REST API error body + HTTP status to a ToolError. */
export function fromApiError(
  status: number,
  body: {
    error?: {
      code?: string;
      message?: string;
      upgrade_url?: string;
      connect_url?: string;
      retry_after_seconds?: number;
      resets_at?: string;
      details?: Record<string, unknown>;
    };
  },
): ToolError {
  const e = body.error ?? {};
  const code = (e.code ?? 'internal_error') as ErrorCode;
  const msg = e.message ?? `Request failed with status ${status}`;

  switch (code) {
    case 'invalid_token':
    case 'missing_or_invalid_token' as ErrorCode:
      return new ToolError('invalid_token', 'Your FindMe API key is invalid or has been revoked.', {
        action: 'Create a new key at https://findme.photo/settings/api',
        link: 'https://findme.photo/settings/api',
      });
    case 'tier_not_eligible':
      return new ToolError('tier_not_eligible', 'API access requires Free+, Growth, or Pro.', {
        action: 'Upgrade your plan.',
        link: e.upgrade_url ?? 'https://findme.photo/pricing',
      });
    case 'upgrade_required':
      return new ToolError('upgrade_required', msg, {
        action: 'Upgrade your plan to continue.',
        link: e.upgrade_url ?? 'https://findme.photo/pricing',
      });
    case 'rate_limited':
      return new ToolError('rate_limited', msg, {
        action: `Try again in ${e.retry_after_seconds ?? '~1 minute'} seconds.`,
        details: { retry_after_seconds: e.retry_after_seconds },
      });
    case 'quota_exceeded':
      return new ToolError('quota_exceeded', msg, {
        action: `Monthly quota resets at ${e.resets_at ?? 'the start of next month'}.`,
        details: { resets_at: e.resets_at },
      });
    case 'drive_not_connected':
      return new ToolError('drive_not_connected', 'Google Drive is not connected to your FindMe account.', {
        action: 'Connect Drive and try again.',
        link: e.connect_url ?? 'https://findme.photo/settings/integrations/drive',
      });
    case 'not_found':
      return new ToolError('not_found', "I couldn't find that in your account.", {
        details: e.details,
      });
    case 'invalid_request':
      return new ToolError('invalid_request', msg, { details: e.details });
    default:
      return new ToolError('internal_error', msg, { details: { status } });
  }
}
