# Apify MCP server

MCP server that exposes [Apify Actors](https://apify.com/store) as tools for AI assistants.

The codebase is built with TypeScript using ES modules and follows a modular architecture with clear separation of concerns.

The server can run in multiple modes:
- **Standard Input/Output (stdio)**: For local integrations and command-line tools like Claude Desktop
- **HTTP Streamable**: For hosted deployments and web-based MCP clients
- **Legacy SSE over HTTP**: Legacy version of the protocol for hosted deployments and web-based clients (deprecated and will be removed in the future)

### Core philosophy

- Simple is better than complex
- If the implementation is hard to explain, it's (usually) a bad idea.
- **Ruthlessly minimal**: Only implement what's explicitly in scope
- **Lightweight**: Measure complexity by lines of code, not abstractions
- **No over-engineering**: Solve the current problem, not hypothetical future ones
- **No unsolicited features**: Don't add anything not explicitly requested by the human operator

## ⚠️ MANDATORY: Verification after every implementation

**THIS IS NON-NEGOTIABLE. DO NOT SKIP.**

After completing ANY code change (feature, fix, refactor), you MUST:

1. **Type check**: `npm run type-check`
   - Fix ALL TypeScript errors before proceeding
   - Zero tolerance for type errors

2. **Lint**: `npm run lint`
   - Fix ALL lint errors before proceeding
   - Use `npm run lint:fix` for auto-fixable issues

3. **Unit tests**: `npm run test:unit`
   - ALL tests must pass
   - If a test fails, fix it before moving on

**What to do if verification fails:**
1. DO NOT proceed to the next task
2. Fix the issue immediately
3. Re-run verification until green
4. Only then continue

## Agent constraints

- **Do NOT use `npm run build` for type-checking.** Use `npm run type-check` — it is faster and skips JavaScript output generation. Only use `npm run build` when compiled output is explicitly needed (e.g., before integration tests or deployment).
- **Do NOT run integration tests as an agent.** They require a valid `APIFY_TOKEN` and are slow; use mcpc probing instead (see below).

## Live MCP probing with mcpc

Use `mcpc` (`@apify/mcpc`) to verify real end-to-end MCP tool behavior. This is the primary way to confirm that an implementation is correct and matches its spec — not just that the code compiles and unit tests pass.

**When to use mcpc probing:**
- After implementing a feature: verify actual tool output matches the spec
- After a bug fix: confirm the fix works end-to-end, not just in unit tests
- When implementing a new tool: explore what it returns, spot schema issues, check error messages
- Any time the spec says "the tool should return X" — prove it does

**Prerequisite**: `APIFY_TOKEN` must be set in the environment, and `@apify/mcpc` must be installed (`npm install -g @apify/mcpc`). See [DEVELOPMENT.md](./DEVELOPMENT.md) for one-time setup.

**Workflow:**

```bash
# 1. Compile the server (required — mcpc runs the compiled dist/stdio.js)
npm run build

# 2. Check if the local session exists
mcpc

# 3a. If @stdio is NOT listed — connect for the first time:
mcpc --config .mcp.json stdio connect @stdio

# 3b. If @stdio IS listed — restart to pick up the new build:
mcpc @stdio restart

# 4. Probe and verify
mcpc @stdio tools-list
mcpc @stdio tools-call search-actors keywords:="web scraper"

# 5. Use --json for machine-readable output
mcpc --json @stdio tools-call search-actors keywords:="web scraper"
```

**Argument syntax**: `key:=value` — values auto-parse as JSON (numbers, booleans, objects). Use `key:="string with spaces"` for string values.

## Testing

### Running tests

- **Unit tests**: `npm run test:unit` (runs `vitest run tests/unit`)
- **Integration tests**: `npm run test:integration` (requires build first, requires `APIFY_TOKEN` — humans only)

### Test structure

- `tests/unit/` — unit tests for individual modules
- `tests/integration/` — integration tests for MCP server functionality
  - `tests/integration/suite.ts` — **main integration test suite** where all test cases should be added
  - Other files in this directory set up different transport modes (stdio, SSE, streamable-http) that all use `suite.ts`
- `tests/helpers.ts` — shared test utilities
- `tests/const.ts` — test constants

### Test guidelines

- Write tests for new features and bug fixes
- Use descriptive test names that explain what is being tested
- Follow existing test patterns in the codebase
- Ensure all tests pass before submitting a PR

### Adding integration tests

**IMPORTANT**: Add integration test cases to `tests/integration/suite.ts`, NOT as separate test files.

`suite.ts` exports `createIntegrationTestsSuite()`, used by all transport modes (stdio, SSE, streamable-http). Adding tests here ensures they run across all transport types.

**How to add a test case:**
1. Open `tests/integration/suite.ts`
2. Add your test case inside the `describe` block
3. Use `it()` or `it.runIf()` for conditional tests
4. Use `client = await createClientFn(options)` to create the test client
5. Always call `await client.close()` when done

**Example:**
```typescript
it('should do something awesome', async () => {
    client = await createClientFn({ tools: ['actors'] });
    const result = await client.callTool({
        name: HelperTools.SOME_TOOL,
        arguments: { /* ... */ },
    });
    expect(result.content).toBeDefined();
    await client.close();
});
```

## External dependencies

**IMPORTANT**: This package (`@apify/actors-mcp-server`) is used in the private `apify-mcp-server-internal` repository for the hosted server. Changes here may affect that server. Breaking changes must be coordinated; check whether updates are needed in `apify-mcp-server-internal` before submitting a PR. See README.md for canary (`beta`) releases via `pkg.pr.new`.

## Further reading

- **[CONTRIBUTING.md](./CONTRIBUTING.md)** — coding standards, patterns, anti-patterns, commit format, PR guidelines, design system rules
- **[DEVELOPMENT.md](./DEVELOPMENT.md)** — project structure, setup, build system, hot-reload workflow, manual MCP testing
- **[DESIGN_SYSTEM_AGENT_INSTRUCTIONS.md](./DESIGN_SYSTEM_AGENT_INSTRUCTIONS.md)** — UI widget design system rules (read this when doing any UI/widget work)
- **[res/](./res/index.md)** — architecture analyses, refactor plans, and protocol references (MCP tasks, SDK features, tool mode separation, etc.)
