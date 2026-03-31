# Markdown Documentation Writing (SKILL)

This skill provides the preferred wording, structure, and formatting instructions for all `.md` files (like `README.md`, `DEVELOPMENT.md`, and `CONTRIBUTING.md`) in the Apify MCP Server project.

## 1. Tone and Wording (Avoiding "AI Slop")
- **Vary Paragraph Starters**: Do not start consecutive paragraphs with the same phrase (e.g., repeating "The Apify MCP Server supports...").
- **Human-Readable & Direct**: Avoid overly verbose, generic "AI-like" marketing speak. Get straight to the technical point.

## 2. Document Structure and Flow
- **Define Before Use**: Always explain what a tool, CLI, or concept is *before* relying on it in the documentation. Include a reference link and explain *why* it is being used over alternatives.
- **Key Information First**: Do not bury important comparisons, prerequisites, or critical differences at the bottom of a section. Put them up front where the reader actually needs them.
- **No Numbered Sections**: Avoid using numbered lists for major document headings or structural outlines. Use unnumbered headers (`##`, `###`) or bullet points. This prevents tedious reordering when new sections are inserted later.

## 3. Technical Accuracy & Consistency
- **Exact Command Mapping**: Ensure documented bash/npm commands exactly match `package.json` scripts and their direct invocations. Do not conflate orchestrator commands (like `npm run dev`) with direct startup commands (like `npm start`) unless explicitly explaining the workflow difference.
- **Consistent Product Names**: Maintain consistent casing and article usage within the same sentence. Always standardize on **"Apify MCP Server"** (capital S) and ensure third-party tools are capitalized consistently.

## 4. Repository Cleanliness
- **No Test Artifacts**: Never leave dummy commits, test HTML comments (e.g., `<!-- Dummy commit for testing PR workflow -->`), or debug scaffolding in the production Markdown files.