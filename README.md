# Tableau Agent Prototype

A local-first prototype that combines the OpenAI Agents SDK with a Tableau MCP server to answer ad-hoc questions against Tableau datasources. The current build targets experimentation on a developer workstation: both the HTTP orchestrator and Tableau MCP server run locally, and no cloud services (other than OpenAI APIs) are involved.

## Key Features
- **Single-turn orchestration** - Triage, field selection, VizQL compilation, Tableau execution, and summarization happen inside `src/orchestrator/run.ts` with per-phase event logging.
- **Triage-driven planning** - The triage agent emits at most two lightweight analysis steps plus optional follow-up suggestions, keeping downstream work fast.
- **VizQL retries with MCP feedback** - The query compiler replays Tableau MCP validation errors to repair filters, aggregations, or field selections automatically.
- **Dual summarization paths** - Lightweight summaries handle small extracts; larger artifacts trigger Code Interpreter (CI) with guarded timeouts and fallbacks.
- **Telemetry hooks** - All phases emit structured events (durations, retries, CI outcomes) to the SSE stream and `logs/analysis.txt` for debugging.

## Repository Layout
- `src/` - Orchestrator, agents, Tableau MCP client, summarization logic, and utilities.
- `prompts/` - XML prompts for the triage, field-selector, vizql-builder, and summarizer agents.
- `frontend/` - Minimal browser UI that streams events and renders final answers.
- `docs/specs/` - Architecture references (`overview-asis.md`, `overview-tobe.md`, `agent-flow.html`).
- `logs/` - Runtime artifacts (analysis log, VizQL JSON exports, cached metadata).

## Prerequisites
- **Node.js 18+** and npm.
- **OpenAI API access** for the Agents SDK and Code Interpreter.
- **Tableau MCP server** running locally with stdio transport (for example [`tableau_mcp_starter_kit`](https://github.com/tableau-mcp/tableau_mcp_starter_kit)).
- Tableau credentials (PAT, site, server URL) with permission to query the target datasource.

## Setup
1. Clone this repository and install dependencies:
   ```bash
   git clone https://github.com/YoshitakaArakawa/tableau-agent
   cd tableau-agent
   npm install
   ```
2. Copy `.env_template` to `.env` and fill in:
   - Tableau connection details (`TRANSPORT`, `SERVER`, `SITE_NAME`, `PAT_*`).
   - Local MCP path (`TABLEAU_MCP_FILEPATH`) pointing to your Tableau MCP server entry script.
   - `OPENAI_API_KEY` for the Agents SDK.
   Optional knobs include `TABLEAU_CLIENT_TIMEOUT_MS`, `SUMMARIZE_CI_TIMEOUT_MS`, and logging toggles.
3. Install and start the Tableau MCP server (separate terminal):
   - Follow the MCP project instructions (typically `npm install`, `npm run build`, then `npm start -- --transport stdio`).
   - Ensure the server is reachable at the path referenced by `TABLEAU_MCP_FILEPATH`.
4. Launch the agent server:
   ```bash
   npm run dev
   ```
   The server listens on `http://localhost:8787` and clears `logs/analysis.txt` on startup.

## Usage
1. Open `http://localhost:8787/` in your browser.
2. Provide a valid `datasourceLuid` and enter a natural-language question (for example "Compare 2024 vs 2023 sales by region").
3. Watch the stream panel for per-phase updates (triage, field selection, fetch, summarization) and review the final Markdown answer. Artifacts are stored under `logs/vdsapi_json/` for inspection.
4. Send follow-up questions using the same conversation to reuse metadata, analysis plans, and artifacts cached in memory.

## Development Notes
- Agents, prompts, and model assignments are defined in `config/models.json` and `prompts/*.xml`.
- The orchestrator logs every event to `logs/analysis.txt`; use `tail -f` for real-time tracing.
- Docs in `docs/specs/` track the as-is architecture, future roadmap, and sequence diagrams.
- Run `npm run dev` with `NODE_ENV=development` (default) to enable verbose logging and CI retries.

## Known Limitations
- Designed for local experimentation; there is no persistence layer beyond process memory.
- UI has limited visualization for timing data (per-phase durations are emitted but not fully rendered).
- CI workloads may time out on very large extracts; lightweight fallbacks provide partial answers.
- Security hardening (CORS tightening, authentication) is out of scope for this prototype.

## License
Released under the ISC license as declared in `package.json`.
