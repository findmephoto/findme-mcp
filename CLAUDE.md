# findme-mcp — Project Memory

## Canonical docs folder

All project docs live at **`/Users/seb/Claude Assistant/projects/findme-mcp/`**. That's the source of truth — keep new learnings there, not in this file.

| Doc | Purpose |
|---|---|
| `RELEASE.md` | **End-to-end release runbook.** Read this before doing any version bump. Covers npm + MCP Registry + findme-photo dep coordination, credential locations, race-window avoidance, verification commands. |
| `MCP_INFRA.md` | Architecture, endpoints, OAuth flow, secrets registry. |
| `TOKEN_ROTATION.md` | When/how to rotate `NPM_TOKEN` and `FINDMEPHOTO_PAT`. |
| `SPEC.md` | Technical spec referenced by REST API route comments. |
| `SETUP.md` / `PRD.md` / `NEXT_STEPS.md` / `TEST_CHECKLIST.md` / `USER_INSTALL_GUIDE.md` | Setup, requirements, launch items, manual verification, install guide. |

## Quick orientation

Two transports, one tool registry (`src/registry.ts`):
- `src/index.ts` — stdio (`npx findme-mcp`). Bidirectional → elicitation works.
- `src/http.ts` — Streamable HTTP factory. Consumed by findme.photo at `app/api/mcp/route.ts`. JSON-response mode → `noopElicitor`, falls back to `needs_input` JSON.

Companion repo: `/Users/seb/findme-photo`. Pins findme-mcp version in:
- `package.json` → `"findme-mcp": "^X.Y.Z"`
- `app/api/mcp/route.ts` → `serverVersion: 'X.Y.Z'`

Both must be bumped on every release.

## The one manual step in any release

`mcp-publisher login github` → device-flow code requires user to authorize via browser. Everything else (npm publish, git push, Vercel deploy verification, MCP Registry publish) runs unattended with credentials already on disk.

For full procedure see `/Users/seb/Claude Assistant/projects/findme-mcp/RELEASE.md`.
