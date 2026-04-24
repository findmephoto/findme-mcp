# FindMe Photo MCP Server

Official [Model Context Protocol](https://modelcontextprotocol.io) server for [FindMe Photo](https://findme.photo) — the AI-powered wedding gallery platform.

Drive your FindMe galleries from Claude, ChatGPT Codex, Cursor, and any other MCP-compatible AI client. Create events, upload photos, pull analytics — all in natural language.

## What it does

> **"Create a FindMe event for the Sarah & Mike wedding on April 22, upload every photo in `~/Pictures/Sarah-Mike` to it, then show me the QR code."**

The AI uses this MCP server to do all three steps in one turn.

## Tools

| Tool | Purpose |
|---|---|
| `create_event` | Create a new gallery. |
| `list_events` | List your events (paginated). |
| `get_event` | Get event details + stats. |
| `update_event` | Rename, re-date, or change access code. |
| `delete_event` | Soft-delete with 7-day recovery. |
| `restore_event` | Un-delete within 7 days. |
| `upload_photos_from_paths` | Upload local files or folders. Primary upload tool. |
| `upload_photos_from_urls` | Upload from public URLs (Dropbox, direct Drive links, etc.). |
| `upload_photos_from_drive_folder` | Import from Google Drive (partial in v1). |
| `get_event_qr` | PNG QR code pointing to the public gallery. |
| `get_event_analytics` | Guest visits, unique visitors, downloads, selfie searches. |
| `get_usage` | Current-month API usage, storage, event totals. |

## Requirements

- Node.js 18+
- A FindMe Photo account on **Free+**, **Growth**, or **Pro**
- A personal API key from <https://findme.photo/settings/api>

## Install

**The easiest way: let the AI install itself.** Paste a prompt, the AI edits its own config. No hidden files.

> For a step-by-step walkthrough aimed at non-technical photographers, see the [full install guide](https://findme.photo/install).

### Claude Desktop

Open Claude Desktop, click the **Code** tab (not Chat), then paste this prompt (replace the key):

```
Install the FindMe MCP server for me.

- Server name: findme
- Command: npx
- Args: -y findme-mcp
- Env var: FINDME_API_KEY = fm_live_PASTE_YOUR_KEY_HERE

Edit my claude_desktop_config.json under mcpServers, then tell me to fully quit and reopen Claude.
```

### Claude Code (CLI)

```bash
claude mcp add findme --scope user --env FINDME_API_KEY=fm_live_xxxxx -- npx -y findme-mcp
```

### ChatGPT Codex

```bash
codex mcp add findme --env FINDME_API_KEY=fm_live_xxxxx -- npx -y findme-mcp
```

### Cursor / Windsurf / VS Code / Cline

Use the tool's built-in MCP install UI with:
- Command: `npx`
- Args: `-y findme-mcp`
- Env: `FINDME_API_KEY=fm_live_xxxxx`

### ChatGPT web / mobile

**Coming soon** — requires a hosted MCP endpoint. We're shipping `mcp.findme.photo` next. In the meantime, use Claude Desktop or Codex.

### Any other MCP client

```bash
FINDME_API_KEY=fm_live_xxxxx npx findme-mcp
```

## Verify

After restart, you should see `findme` in your client's tool list (12 tools). Try:

> Create a FindMe event called "My First Gallery" for today, then show me the QR code.

## Troubleshooting

### "MCP server failed to start"

- Ensure Node.js 18+: `node --version`
- First run downloads the package via `npx`; allow it through your firewall
- Check the JSON is valid if you edited manually (no trailing commas)

### "Your FindMe API key is invalid or has been revoked"

- Generate a fresh key at <https://findme.photo/settings/api>
- Paste the full key including the `fm_live_` prefix
- Fully quit and restart your AI client

### "API access requires Free+, Growth, or Pro"

API access is a paid-tier feature. Upgrade at <https://findme.photo/pricing>.

### Upload fails with "can't find folder" on macOS

macOS privacy protection. Open *System Settings → Privacy & Security → Full Disk Access* and add your AI client (Claude Desktop, Terminal, etc.). Then quit and reopen.

### Upload partially failed

The tool never errors a whole batch for one bad file — it returns a summary showing which files succeeded and which didn't. Ask the AI to retry the failed ones specifically.

## Limits

| Tier | Rate limit | Monthly quota |
|---|---|---|
| Free+ | 10 req/min | 500 / month |
| Growth | 60 req/min | 10,000 / month |
| Pro | 300 req/min | Unlimited |

Per file: 50 MB photos, 500 MB videos, 50 files per upload batch.

## v1 limitations

- `upload_photos_from_drive_folder` requires an existing Drive import created via the findme.photo web UI; the MCP can poll status but not create imports yet.
- The MCP runs locally on the same machine as your AI client; it only sees files on that machine.

## Resources

- [FindMe Photo](https://findme.photo)
- [Install guide](https://findme.photo/install)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

[MIT](./LICENSE) — © 2026 FindMe Photo
