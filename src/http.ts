// HTTP transport for findme-mcp. Exports a factory that returns a
// `(req: Request) => Promise<Response>` handler — drop it into any web
// runtime: Next.js route, Cloudflare Worker, Hono, Bun, Deno.
//
// Auth model: the host application authenticates the request (e.g. via
// OAuth bearer in Next.js middleware) and passes a FindMe API key into
// the factory's `resolveApiKey` callback. The handler creates a fresh
// FindMeClient per JSON-RPC call, then delegates tool execution to the
// shared registry.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { FindMeClient } from './client.js';
import { ToolError } from './errors.js';
import { dispatchToolCall, getRemoteSafeDefinitions } from './registry.js';

export interface CreateMcpHandlerOptions {
  /**
   * Async resolver: takes the inbound Request, returns the FindMe API key
   * to use for tool calls. Throw to reject the request (the host app
   * should normally enforce auth before this is called, but this gives
   * a last-line guard).
   */
  resolveApiKey: (req: Request) => Promise<string> | string;
  /**
   * Optional override for the FindMe API base URL (staging/dev).
   */
  baseUrl?: string;
  /**
   * Server name + version surfaced in the MCP `initialize` response.
   * Defaults to 'findme-mcp' / package version.
   */
  serverName?: string;
  serverVersion?: string;
}

/**
 * Build a Web-standard request handler implementing the MCP Streamable
 * HTTP transport. Stateless — every request creates a fresh Server +
 * transport pair and resolves to a single JSON response.
 */
export function createMcpHandler(opts: CreateMcpHandlerOptions): (req: Request) => Promise<Response> {
  const {
    resolveApiKey,
    baseUrl,
    serverName = 'findme-mcp',
    serverVersion = process.env.npm_package_version ?? '0.2.0',
  } = opts;

  return async function handle(req: Request): Promise<Response> {
    // OPTIONS preflight: bare-bones CORS so browser-based MCP clients can connect.
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(req),
      });
    }

    let apiKey: string;
    try {
      apiKey = await resolveApiKey(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      return jsonError(401, 'unauthorized', message, req);
    }

    if (!apiKey) {
      return jsonError(401, 'unauthorized', 'Missing API key', req);
    }

    const client = new FindMeClient({ apiKey, baseUrl });

    const server = new Server(
      { name: serverName, version: serverVersion },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getRemoteSafeDefinitions(),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const result = await dispatchToolCall(
        client,
        request.params.name,
        request.params.arguments,
        { remoteOnly: true },
      );
      return result as unknown as CallToolResult;
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,  // stateless
      enableJsonResponse: true,       // return application/json instead of SSE
    });

    try {
      await server.connect(transport);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transport setup failed';
      return jsonError(500, 'internal_error', message, req);
    }

    let response: Response;
    try {
      response = await transport.handleRequest(req);
    } catch (err) {
      if (err instanceof ToolError) {
        return jsonError(400, err.code, err.message, req);
      }
      const message = err instanceof Error ? err.message : 'Transport error';
      return jsonError(500, 'internal_error', message, req);
    }

    // Append CORS headers so browser MCP clients (ChatGPT web) can read responses.
    const cors = corsHeaders(req);
    for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);

    return response;
  };
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonError(status: number, code: string, message: string, req: Request): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message, data: { error_code: code } },
      id: null,
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(req) },
    },
  );
}
