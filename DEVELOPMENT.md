# Development

## Overview

This repository (**public**) provides:
- The core MCP server implementation (published as an NPM package)
- The stdio entry point (CLI)
- The Apify Actor standby HTTP server used for local development/testing

The hosted server (**[mcp.apify.com](https://mcp.apify.com)**) is implemented in an internal Apify repository that depends on this package.

For general information about the Apify MCP Server, features, tools, and client setup, see the [README.md](./README.md).

## Project structure (high-level)

```text
src/
  actor/        Standby Actor HTTP server (used by src/main.ts in STANDBY mode)
  mcp/          MCP protocol implementation
  tools/        MCP tool implementations
  resources/    Resources and widgets metadata
  utils/        Shared utilities
  web/          React UI widgets (built into dist/web)
tests/
  unit/         Unit tests
  integration/  Integration tests
```

Key entry points:

- `src/index.ts` - Main library export (`ActorsMcpServer` class)
- `src/index_internals.ts` - Internal exports for testing / advanced usage
- `src/stdio.ts` - Standard input/output (CLI) entry point
- `src/main.ts` - Actor entry point (standby server / debugging)
- `src/input.ts` - Input processing and validation

## Node.js version policy

The minimum supported Node.js version is **18** (`engines.node >= 18` in `package.json`).

**Why Node.js 18 (not higher):**
The MCP server is installed by end-users via `npx` and must work on the widest reasonable range of Node.js versions. Our key dependency, `@modelcontextprotocol/sdk`, requires Node.js >= 18, and our own source code uses no APIs beyond what Node.js 18 provides. Sentry telemetry showed ~20K crash events from users on older Node versions (`File is not defined`, `ReadableStream is not defined`), confirming that many users run older runtimes.

**Rules for maintaining compatibility:**
- Do not use Node.js APIs introduced after v18 (e.g., `import.meta.resolve`, `Array.fromAsync`, `Set.union()`).
- Do not add dependencies that require Node.js > 18 at runtime. Check `engines` field of new dependencies before adding them.
- CI runs unit tests against Node.js 18, 20, 22, and 24 to catch compatibility regressions.
- The `.nvmrc` file pins the latest Node.js version for development tooling (lint, type-check, build) — this is intentionally higher than the minimum supported version.

## How to contribute

Refer to the [CONTRIBUTING.md](./CONTRIBUTING.md) file.

### Installation

```bash
npm install
cd src/web && npm install
```

### Working on the MCP Apps (ChatGPT Apps) UI widgets

Widget code lives in `src/web/` (a self-contained React project). Widgets are rendered based on tool output — to add data to a widget, modify the corresponding tool's return value.

> **UI mode:** Widget rendering requires the server to run in UI mode. Use `?ui=true` (e.g., `/mcp?ui=true`) or set `UI_MODE=true`.

See the [OpenAI Apps SDK documentation](https://developers.openai.com/apps-sdk) for background on MCP Apps and widgets.

### Production build

```bash
npm run build
```

Builds the core TypeScript project and `src/web/` widgets, then copies widgets into `dist/web/`. Required before running integration tests or the compiled server.

### Hot-reload development

```bash
APIFY_TOKEN='your-apify-token' npm run dev
```

Starts the web widgets builder in watch mode and the MCP server in standby mode on port `3001`. Editing `src/web/src/widgets/*.tsx` triggers a hot-reload — the next widget render uses updated code without restarting the server. Adding new widget filenames requires reconnecting the MCP client to pick them up.

- Get your `APIFY_TOKEN` from [Apify Console](https://console.apify.com/settings/integrations)
- Preview widgets via the local esbuild dev server at `http://localhost:3226/index.html`

### Configuring APIFY_TOKEN for Claude Code

Create or edit `.claude/settings.local.json`:

```json
{
  "env": {
    "APIFY_TOKEN": "<YOUR_APIFY_API_TOKEN>"
  }
}
```

Restart Claude Code for the change to take effect. This token is picked up by both Claude Code MCP servers (defined in `.mcp.json`) and mcpc.

## Testing

This repo has three complementary layers of testing:

| Layer | Command | What it covers                                                                                                        |
|---|---|-----------------------------------------------------------------------------------------------------------------------|
| **Unit tests** | `npm run test:unit` | Individual modules in isolation — input parsing, tool schemas, utilities                                              |
| **Integration tests** | `npm run test:integration` | Full server lifecycle over all three transports (stdio, SSE, streamable HTTP) against the real Apify API (human only) |
| **mcpc probing** | `mcpc @stdio tools-call ...` | Interactive end-to-end verification during development                                                                |

**Unit tests** run without credentials or network access — fast and safe at any time.

**Integration tests** require `APIFY_TOKEN` and `npm run build`. They spin up the real server, connect a real MCP client, and call actual tools. All tests in `tests/integration/suite.ts` run across all three transports automatically.

**mcpc probing** is a development tool, not a test suite — use it to explore behavior, verify a fix end-to-end, or check what the server returns before writing a formal test.

### Live probing with mcpc

`mcpc` (`@apify/mcpc`) gives both humans and AI agents a fast command-line feedback loop against the local server.

**Why mcpc instead of connecting Claude directly to the server:**
Claude Code can connect to an MCP server via `.mcp.json` when running locally, but remote Claude sessions (claude.ai, CI) cannot reach a locally running server. mcpc is a CLI tool that works identically in all environments.

#### One-time setup

```bash
npm install -g @apify/mcpc
npm run build
mcpc --config .mcp.json stdio connect @stdio
mcpc @stdio tools-list   # verify
```

#### After each code change

```bash
npm run build
mcpc @stdio restart
mcpc @stdio tools-call search-actors keywords:="web scraper"
```

#### Exploring and calling tools

Arguments use `key:=value` syntax — values auto-parse as JSON (numbers, booleans, objects):

```bash
mcpc @stdio tools-list
mcpc @stdio tools-get search-actors

mcpc @stdio tools-call search-actors keywords:="web scraper" limit:=5
mcpc @stdio tools-call fetch-actor-details actorId:="apify/rag-web-browser"
mcpc @stdio tools-call call-actor actorId:="apify/rag-web-browser" input:='{"query":"hello"}'

# Parse output with jq
mcpc --json @stdio tools-call search-actors keywords:="scraper" | jq '.content[0].text | fromjson'
```

**Key behaviors to verify:**
- `search-actors` — test valid keywords, empty keywords, pagination (`limit`, `offset`)
- `fetch-actor-details` — test valid Actor, non-existent Actor
- `call-actor` — test with valid input; check async mode
- `get-actor-output` — test field filtering with dot notation, non-existent dataset
- `search-apify-docs` / `fetch-apify-docs` — test relevant and non-existent queries


### Testing with MCPJam (optional)

Run [MCPJam](https://www.mcpjam.com/) with `npx @mcpjam/inspector@latest`.

1. Click **"Add new server"**, enter URL `http://localhost:3001/mcp?ui=true`, select **"No authentication"**
2. **App Builder** — select a tool, fill arguments, execute, view rendered widget
3. **Chat** — add an OpenAI/Anthropic/OpenRouter API key to chat with widget rendering inline

### Testing with ChatGPT (optional)

Test widget rendering on [chatgpt.com](https://chatgpt.com) by exposing the local server via ngrok. See the [Apify ChatGPT integration docs](https://docs.apify.com/platform/integrations/chatgpt) for background.

The ngrok credentials are in **1Password**. The static domain `mcp-apify.ngrok.dev` is already set up — add to `~/.config/ngrok/ngrok.yml`:

```yaml
tunnels:
  app:
    addr: 3001
    proto: http
    domain: mcp-apify.ngrok.dev
```

Then start the tunnel:

```bash
ngrok start app
```

The MCP server API will be reachable at `https://mcp-apify.ngrok.dev/mcp?ui=true`.

#### Adding the server in ChatGPT

1. Go to [chatgpt.com](https://chatgpt.com) and open **Settings → Connectors**
2. Click **"Add a custom connector"**
3. Enter the URL: `https://mcp-apify.ngrok.dev/mcp?ui=true`
4. Save and start a new chat

> **Important:** After restarting ngrok, use the **Refresh** button in the connector settings to reconnect — ChatGPT does not detect the tunnel restart automatically.
