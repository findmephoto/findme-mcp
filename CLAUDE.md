# findme-mcp — Release & Maintenance Runbook

This is the official MCP server for FindMe Photo. It ships to **npm**, the **MCP Registry**, and is consumed by **findme.photo's HTTP `/api/mcp` endpoint**. Every release touches all three surfaces.

## Architecture

**Two transports, one tool registry.** `src/registry.ts` defines all tools and dispatches calls. Both transports import from it.

- `src/index.ts` — stdio entrypoint (`npx findme-mcp`). Used by Claude Desktop, Cursor, Continue, Cline, Zed. Bidirectional → supports MCP elicitation forms.
- `src/http.ts` — Streamable HTTP factory. Imported by findme.photo at `app/api/mcp/route.ts`. Currently runs in `enableJsonResponse: true` mode (single JSON response, no SSE). Cannot carry server→client requests, so passes `noopElicitor` and falls back to JSON `needs_input` payloads.

**Tool list (12 total).** `upload_photos_from_paths` is stdio-only (needs local fs); the other 11 are exposed over HTTP via `getRemoteSafeDefinitions()`.

**Elicitation.** `src/elicit.ts` wraps `server.elicitInput()` with a transport-aware capability check. `create_event` uses it when album_quality / enable_downloads / is_collaborative are missing. Form-supporting hosts (Claude Desktop) render radio buttons + toggles; everyone else gets the text fallback.

## Companion repo: findme.photo

Lives at `/Users/seb/findme-photo`. Two things it pins to findme-mcp:

1. `package.json` → `"findme-mcp": "^X.Y.Z"` — version range for the npm dependency
2. `app/api/mcp/route.ts` line ~24 → `serverVersion: 'X.Y.Z'` — hardcoded string surfaced in the MCP `initialize` response

**Both must be bumped on every release.** Caret ranges with zero-major (`^0.X.0`) do NOT auto-pull minor bumps — `^0.4.0` will not install `0.5.0`. Always bump the manifest explicitly.

## Authentication — what's preconfigured

| What | Where | How to use |
|---|---|---|
| **npm publish token** (bypass-2FA, scoped to findme-mcp) | `/Users/seb/findme-mcp/.env` as `NPM_TOKEN` | Local `.npmrc` references `${NPM_TOKEN}`. Just `source .env && npm publish` from the repo. Both files gitignored. |
| **Vercel API token** | `/Users/seb/findme-photo/.env.local` as `VERCEL_TOKEN` | Use to query deployment status: `curl -H "Authorization: Bearer $VERCEL_TOKEN" https://api.vercel.com/v6/deployments?projectId=prj_ypzHMvRdtChpjebWPspAVSPmzBwy&teamId=venturesuccess` |
| **GitHub git push** | SSH/HTTPS already configured | Works out of the box — `git push origin main --tags` |
| **mcp-publisher binary** | `~/.local/bin/mcp-publisher` (v1.7.0+, darwin arm64) | Authenticated via short-lived GitHub OAuth JWT. **Token expires roughly hourly** — re-login if you see a 401. |

## The ONE manual step

`mcp-publisher login github` triggers a device-flow code that **requires the user to authorize via browser**. This is the only thing Claude can't automate. Surface the code clearly and wait for confirmation:

```
cd /Users/seb/findme-mcp && ~/.local/bin/mcp-publisher login github
# → prints a code like XXXX-XXXX
# → user opens https://github.com/login/device, enters code, authorizes
# → background command exits with success
```

Do this BEFORE `mcp-publisher publish`. If you forget, publish will fail with a 401 expired-JWT error.

## Standard release workflow

For a typical update — say adding a field to a tool, or fixing a bug. Use this order to avoid race windows where a published MCP version expects API changes that haven't deployed yet.

### 1. If the change requires findme.photo API changes, do those FIRST

Edit `/Users/seb/findme-photo/app/api/v1/...`, run `npm run build` to verify, commit + push. Wait for Vercel deploy READY before continuing:

```bash
# In /Users/seb/findme-photo:
git add path/to/changed/file && git commit -m "..." && git push origin main

# Watch deploy:
until curl -s "https://api.vercel.com/v6/deployments?projectId=prj_ypzHMvRdtChpjebWPspAVSPmzBwy&teamId=venturesuccess&limit=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); s=d['deployments'][0]['state']; print(s); sys.exit(0 if s=='READY' else 1)"; do sleep 15; done
```

This guarantees Claude Desktop users on the new MCP version don't hit an old API that rejects new fields.

### 2. Update findme-mcp source

Edit files under `/Users/seb/findme-mcp/src/`. If you change a tool definition, both the zod schema (`Schema`) AND the JSON Schema in the tool definition (`Definition`) must match — the SDK trusts the JSON Schema for the client UI but uses zod for runtime validation.

### 3. Bump version in THREE places

- `package.json` → `"version": "X.Y.Z"`
- `server.json` → both `"version": "X.Y.Z"` and `packages[0].version`
- `src/index.ts` → `const PACKAGE_VERSION = 'X.Y.Z'`

Semver: bug fix = patch (0.4.1), additive feature = minor (0.5.0), breaking = major.

### 4. Build, commit, tag, push

```bash
cd /Users/seb/findme-mcp
npm run build  # tsc — verifies types
git add -A
git commit -m "X.Y.Z: <one-line summary>

<body>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git tag vX.Y.Z
git push origin main --tags
```

### 5. Publish to npm

```bash
cd /Users/seb/findme-mcp && set -a && source .env && set +a && npm publish
```

The `prepublishOnly` hook reruns `tsc`, so the dist is always fresh. Verify:

```bash
npm view findme-mcp version  # should show X.Y.Z
```

### 6. Publish to MCP Registry

JWT from previous mcp-publisher login probably expired (lifetime ~1 hour). Re-login first:

```bash
cd /Users/seb/findme-mcp && ~/.local/bin/mcp-publisher login github
# Surface the code to user, wait for "Successfully authenticated"
```

Then publish:

```bash
cd /Users/seb/findme-mcp && ~/.local/bin/mcp-publisher publish
```

Verify:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=findme" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"{s['server']['name']} v{s['server']['version']}\") for s in d.get('servers',[])[-3:]]"
```

### 7. Bump findme-photo's dependency

```bash
cd /Users/seb/findme-photo
# Edit package.json: bump "findme-mcp" caret range
# Edit app/api/mcp/route.ts: bump serverVersion string
npm install   # refreshes lockfile to pull new findme-mcp
npm run build # verify nothing broke
git add package.json package-lock.json app/api/mcp/route.ts
git commit -m "mcp: bump findme-mcp to X.Y.Z

<body>"
git push origin main
```

Wait for Vercel deploy READY again.

### 8. Verify the live HTTP endpoint serves the new version

Need a fm_live_* token. Ask the user for one if not handy; they can revoke after.

```bash
curl -s -X POST https://findme.photo/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer fm_live_xxx" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify","version":"1.0"}}}' \
  | python3 -m json.tool
# → serverInfo.version should be X.Y.Z
```

For a tool-list check:

```bash
curl -s -X POST https://findme.photo/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer fm_live_xxx" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(t['name'], list(t['inputSchema']['properties'].keys())) for t in d['result']['tools']]"
```

## Client cache caveat

Claude.ai mobile / web custom connectors **cache the tools list at connector creation time**. Bumping the server version does NOT propagate new tool definitions to existing connectors. Users have to either:

- Disconnect + re-add the connector (sometimes broken — see "Invalid server ID format" bug)
- Add a new connector with a different display name pointing at the same URL
- Wait for Anthropic to ship MCP `notifications/tools/list_changed` honoring + UI

For Claude Desktop / stdio hosts: quitting and restarting Claude Desktop forces fresh tool list. `npx -y` re-resolves but caches; `rm -rf ~/.npm/_npx` is the bulletproof reset.

## What we deliberately don't do (yet)

- **SSE on the HTTP transport.** Switching `enableJsonResponse: false` would let server→client elicitation requests work over HTTP — but ChatGPT and Claude.ai web connectors don't render elicitation forms today, so the gain is zero. Revisit when those hosts ship support.
- **Server-side `notifications/tools/list_changed` push.** Requires SSE. Same blocker.
- **Patching album_quality post-upload.** Schema lock at the API. Changing storage resolution after photos exist would either lose data or require a re-encode pass — neither sensible. Locked at first upload by design.

## File map

```
src/
├── client.ts              FindMe REST API client (fetch wrapper)
├── elicit.ts              MCP elicitation helper (form requests with capability gating)
├── errors.ts              ToolError class + ErrorCode enum + REST→MCP error mapping
├── http.ts                Streamable HTTP factory (consumed by findme.photo)
├── index.ts               stdio entrypoint (npx findme-mcp)
├── registry.ts            Tool definitions + dispatch
├── tool-helpers.ts        safeToolHandler + jsonResult / textResult
└── tools/
    ├── events-crud.ts     create / list / get / update / delete / restore / qr / analytics
    ├── get-usage.ts       Quota + tier limits
    └── upload.ts          upload_photos_from_paths / _from_urls / _from_drive_folder
```

## When something breaks

- **`npm publish` returns 403 / OTP error** → token rotated. Generate a new GAT at https://www.npmjs.com/settings/~/tokens with bypass-2FA and replace `NPM_TOKEN` in `.env`. (User must have 2FA enabled on npm to create a bypass-2FA token.)
- **`mcp-publisher publish` returns 401 expired** → re-run `mcp-publisher login github`, get the device code, hand to user.
- **Vercel deploy fails** → check `https://vercel.com/venturesuccess/findme-photo/deployments` (or query the API). Most often a typecheck failure — fix and push again.
- **Tool changes don't reach Claude clients** → cache. See "Client cache caveat" above.
