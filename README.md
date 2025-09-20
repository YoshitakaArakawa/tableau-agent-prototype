# Tableau Agent Prototype

A local-first prototype that combines the OpenAI Agents SDK with a Tableau MCP server to answer ad-hoc questions against Tableau datasources. The current build targets workstation experimentation: both the HTTP orchestrator and Tableau MCP server run locally, and no external services are required beyond OpenAI APIs.

## Project Overview
The agent accepts natural-language prompts, plans lightweight Tableau analyses, executes VizQL queries via Tableau MCP, and returns Markdown summaries. The orchestrator streams per-phase events over Server-Sent Events (SSE) so the UI can surface total elapsed time alongside phase durations once timing metadata becomes available.

## Why Tableau MCP?
Tableau MCP provides transport-agnostic tools for querying Tableau metadata and datasources. By pairing it with the Agents SDK, this prototype keeps orchestration logic in TypeScript while delegating query execution and validation to Tableau-native tooling.

## Core Features
- **Triage-driven planning** capped at two analysis steps with optional follow-up suggestions.
- **Field selection guardrails** that honor required fields and filter hints from triage output.
- **VizQL retries with feedback loops** that replay Tableau validation errors into the builder prompt.
- **Dual summarization paths** that fall back from Code Interpreter to lightweight summaries when needed.
- **Streaming telemetry** that emits structured SSE events and maintains a local analysis log for debugging.

## Prerequisites
- **OpenAI API access** for the Agents SDK and Code Interpreter.
- **Tableau MCP server** running locally with stdio transport.
- Tableau credentials (PAT, site, server URL) that can query the target datasource.

## Data Handling Warning
Tableau data is relayed to OpenAI services during summarization. For learning or testing, rely on public or de-identified datasets (for example Tableau's Sample Superstore) that are safe to share with AI providers.

## Installation
### 1. Prepare Node.js, npm, and Tableau MCP
Follow Tableau's official [Getting Started guide](https://tableau.github.io/tableau-mcp/docs/getting-started) to install Node.js, run 
pm install and 
pm run build, and configure the MCP client with stdio transport.

### 2. Clone the repository
```bash
git clone https://github.com/YoshitakaArakawa/tableau-agent
cd tableau-agent
```

### 3. Install project dependencies
```bash
npm install
```
*The included `package.json` already depends on `@openai/agents` and `zod@3`. If you need to reinstall them manually, run `npm install @openai/agents zod@3`.*

### 4. Launch the developer server
```bash
npm run dev
```
Browse to `http://localhost:8787` to use the UI.

## Configuration
1. Copy `.env_template` to a private secrets file and keep it out of source control.
2. Populate Tableau connection details (server URL, site, PAT name/value), the local MCP entry path, and your OpenAI API key.
3. Optional settings include client timeouts, summarization timeouts, and logging toggles surfaced in the template.
4. Restart the developer server whenever configuration values change.

## Running the Agent
### Browser workflow
1. Navigate to `http://localhost:8787/`.
2. Provide a valid `datasourceLuid` and submit a natural-language question.
3. Observe the stream panel as triage, field selection, VizQL execution, and summarization progress; final answers render in Markdown.
4. Submit follow-up questions in the same session to reuse cached metadata and the latest triage context.

### End-to-end trial checklist
- Confirm the triage plan emits no more than two steps and includes optional follow-up suggestions when appropriate.
- Verify the stream panel renders elapsed time once `durationMs` values arrive for each phase.
- Inspect the local analysis log to correlate retries, feedback, and CI fallbacks with what the UI displays.

## Telemetry and Troubleshooting
- SSE events include `metadata`, `triage`, `selector`, `fetch`, `summarize`, and `final` phases with retry counts and timing data.
- VizQL build failures append Tableau validation errors to the retry payload; repeated failures often indicate missing filters or unsupported aggregations.
- When Code Interpreter times out, the orchestrator falls back to lightweight summaries and notes the fallback reason in the final event payload.

## Development Workflow
- Agent prompts live under `prompts/*.xml`, and model routing is configured in `config/models.json`.
- The orchestrator entry point (`src/orchestrator/run.ts`) wires triage, selector, VizQL builder, Tableau execution, and summarization phases.
- For a detailed phase-by-phase walkthrough, open `agent-flow.html` at the repository root.
- Architecture references and roadmap material are maintained within the internal documentation bundle to keep the README focused on setup.

## License
Released under the ISC license as declared in `package.json`.





