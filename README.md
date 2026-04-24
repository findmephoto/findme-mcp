# FindMe Photo MCP Server

Official Model Context Protocol (MCP) server for [FindMe Photo](https://findme.photo) — the AI-powered wedding gallery platform.

Lets photographers drive their galleries from Claude, ChatGPT (MCP connectors), Cursor, and other MCP-compatible AI clients. Natural-language control over event creation, photo uploads, analytics, and more.

## What it does

> **"Create a FindMe event for the Sarah & Mike wedding on April 22, then upload every photo in `~/Pictures/Sarah-Mike` to it, then show me the QR code."**

The AI uses this MCP server to do all three steps in one turn.

## Tools

| Tool | Purpose |
|---|---|
| `upload_photos_from_paths` | Upload local files/folders. Primary upload tool. |
| `upload_photos_from_urls` | Upload from public URLs (Dropbox, direct Drive links, etc.) |
| `upload_photos_from_drive_folder` | Import from Google Drive (partial in v1 — see below). |
| `create_event` | Create a new gallery. |
| `list_events` | List your events (paginated). |
| `get_event` | Get event details + stats (photos, visits, searches). |
| `update_event` | Rename, re-date, or change access code. |
| `delete_event` | Soft-delete with 7-day recovery. |
| `restore_event` | Un-delete within 7 days. |
| `get_event_qr` | Get a PNG QR code pointing to the public gallery. |
| `get_event_analytics` | Guest visits, unique visitors, downloads, selfie searches. |
| `get_usage` | Current-month API usage, storage, event totals. |

## Requirements

- Node.js 18+ (for native `fetch` support)
- A FindMe Photo account on **Free+**, **Growth**, or **Pro** tier
- A personal API key from <https://findme.photo/settings/api>

## Install

### Claude Desktop

1. Create a key at <https://findme.photo/settings/api> (copy it immediately — shown once).
2. Open your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
3. Add the FindMe entry:

```json
{
  "mcpServers": {
    "findme": {
      "command": "npx",
      "args": ["-y", "findme-mcp"],
      "env": {
        "FINDME_API_KEY": "fm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

4. Restart Claude Desktop. You should see the FindMe tools in the MCP panel.

### Cursor

Settings → MCP → Add server → paste the same config structure.

### Claude Code

```bash
claude mcp add findme \
  --env FINDME_API_KEY=fm_live_xxxxx \
  -- npx -y findme-mcp
```

### Any other MCP client

Launch with:
```bash
FINDME_API_KEY=fm_live_xxxxx npx findme-mcp
```

## Troubleshooting

### "MCP server failed to start"

- Ensure Node.js 18+ is installed: `node --version`
- First run downloads the package via `npx`; allow it through your firewall
- Check your config file JSON is valid (no trailing commas)

### "Your FindMe API key is invalid or has been revoked"

- Generate a fresh key at <https://findme.photo/settings/api>
- Paste the full key including the `fm_live_` prefix
- Restart your AI client after updating the config

### "API access requires Free+, Growth, or Pro"

API access is a paid-tier feature. Upgrade at <https://findme.photo/pricing>.

### "I can't find that folder" when uploading from my computer

- The MCP server runs on the machine hosting your AI client. It can't reach files on another device.
- On macOS: if the folder is in Documents/Desktop/Downloads, grant Claude Desktop **Full Disk Access** in *System Settings → Privacy & Security*.

### Upload partially failed

The tool never errors a whole batch for one bad file — it returns a summary showing which files succeeded and which didn't. Ask your AI to retry the failed ones specifically.

## Limits

| Tier | Rate limit | Monthly quota |
|---|---|---|
| Free+ | 10 req/min | 500 / month |
| Growth | 60 req/min | 10,000 / month |
| Pro | 300 req/min | Unlimited |

Per file: 50 MB photos, 500 MB videos, 50 files per upload batch.

## v1 limitations

- **Drive folder imports (new)** — creating a new Drive import via this MCP is not yet wired in v1. Use findme.photo's Drive Picker UI to create the import; the MCP can still poll its status.
- The MCP runs locally alongside your AI client and only sees files on that same machine.

## Resources

- [FindMe Photo](https://findme.photo)
- [Developer docs](https://findme.photo/developers)
- [API reference](https://findme.photo/developers/reference)
- [MCP setup guide](https://findme.photo/developers/mcp)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

[MIT](./LICENSE) — © 2026 FindMe Photo
