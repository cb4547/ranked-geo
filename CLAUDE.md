# GEO Agent Team

**Generative Engine Optimization** (GEO) multi-agent system built with the Claude Agent SDK. Optimizes client content to appear in AI-generated answers from ChatGPT, Perplexity, Claude, Gemini, Copilot, and similar AI engines.

## Quick Start

```bash
# Install dependencies
cd geo-team
npm install

# Run for a client
npx ts-node run.ts --client acme-corp
```

## Architecture Overview

The system runs 11 specialized agents across 7 sequential phases, with parallel execution in Phase 1.

```
Phase 1 (Parallel) ──────────────────────────────────────────
  content-intelligence   → content-gap-report.json
  query-research         → query-opportunity-map.json
  competitor-intelligence→ competitor-report.json
  visibility-monitor     → visibility-report.json

Phase 2 ──────────────────────────────────────────────────────
  brand-voice            → brand-voice.json  [cached per client]

Phase 3 ──────────────────────────────────────────────────────
  citation-builder       → citation-package.json

Phase 4 ──────────────────────────────────────────────────────
  content-writer         → content-draft.md

Phase 5 ──────────────────────────────────────────────────────
  schema-structure       → schema-markup.json

Phase 6 ──────────────────────────────────────────────────────
  qa-publish             → qa-report.json

Phase 7 ──────────────────────────────────────────────────────
  reporting              → final-report.md + final-report.json
```

## Agent Specifications

| Agent | Model | Tools | Role |
|-------|-------|-------|------|
| geo-orchestrator | claude-opus-4-6 | Read, WebSearch, WebFetch, Bash | Master coordinator (Claude Code only) |
| content-intelligence | claude-sonnet-4-6 | Read, WebSearch, WebFetch | Content audit & gap analysis |
| query-research | claude-sonnet-4-6 | Read, WebSearch, WebFetch | AI query behavior mapping |
| brand-voice | claude-haiku-4-5 | Read, WebSearch, WebFetch | Brand voice extraction |
| content-writer | claude-sonnet-4-6 | Read, WebSearch, WebFetch, Write | GEO content creation |
| citation-builder | claude-sonnet-4-6 | Read, WebSearch, WebFetch | Authoritative citation research |
| schema-structure | claude-haiku-4-5 | Read, WebSearch, WebFetch | JSON-LD structured data |
| competitor-intelligence | claude-sonnet-4-6 | Read, WebSearch, WebFetch | Competitor AI citation monitoring |
| visibility-monitor | claude-sonnet-4-6 | Read, WebSearch, WebFetch | AI visibility tracking |
| qa-publish | claude-sonnet-4-6 | Read, WebSearch, WebFetch, Write | Quality gating |
| reporting | claude-haiku-4-5 | Read, WebSearch, WebFetch | Report generation |

## Client Configuration Schema

Create `geo-team/clients/{client-slug}.json`:

```json
{
  "domain": "example.com",
  "niche": "B2B SaaS for HR teams",
  "target_audience": "HR managers at mid-size companies, 50-500 employees",
  "competitors": [
    "competitor1.com",
    "competitor2.com"
  ],
  "target_queries": [
    "what is HRIS software",
    "best HR software for small business",
    "how to automate onboarding"
  ],
  "brand_voice_cache": null,
  "max_budget_usd": 5
}
```

### Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `domain` | ✓ | Client's primary domain (no https://) |
| `niche` | ✓ | Specific niche — be descriptive |
| `target_audience` | ✓ | Detailed audience profile |
| `competitors` | ✓ | Up to 5 competitor domains |
| `target_queries` | ✓ | 20-50 queries to test and track |
| `brand_voice_cache` | — | Path to cached brand voice JSON (relative to geo-team/) |
| `max_budget_usd` | — | Per-run budget cap (default: $5) |

## Directory Structure

```
geo-team/
├── run.ts                        # Main orchestrator
├── package.json
├── tsconfig.json
├── CLAUDE.md                      # This file
├── clients/
│   ├── example-client.json         # Schema reference
│   └── {client-slug}.json          # Client configs
├── outputs/
│   └── {client-slug}/
│       └── {YYYY-MM-DD}/
│           ├── content-gap-report.json
│           ├── query-opportunity-map.json
│           ├── competitor-report.json
│           ├── visibility-report.json
│           ├── brand-voice.json
│           ├── citation-package.json
│           ├── content-draft.md
│           ├── schema-markup.json
│           ├── qa-report.json
│           ├── final-report.md
│           └── final-report.json
└── logs/
    └── {YYYY-MM-DD}.jsonl          # Structured event log

.claude/agents/                     # Claude Code subagent definitions
├── geo-orchestrator.md
├── content-intelligence.md
├── query-research.md
├── brand-voice.md
├── content-writer.md
├── citation-builder.md
├── schema-structure.md
├── competitor-intelligence.md
├── visibility-monitor.md
├── qa-publish.md
└── reporting.md
```

## Log Format

All events are written to `geo-team/logs/{YYYY-MM-DD}.jsonl`. Each line is a JSON object:

```json
{"timestamp":"2025-03-23T10:00:00.000Z","event":"run_start","client":"acme-corp","domain":"acme-corp.com"}
{"timestamp":"2025-03-23T10:00:01.000Z","event":"agent_start","agent":"content-intelligence","model":"claude-sonnet-4-6","allocated_budget_usd":0.75}
{"timestamp":"2025-03-23T10:00:05.000Z","event":"tool_call","agent":"content-intelligence","tool":"WebFetch"}
{"timestamp":"2025-03-23T10:01:30.000Z","event":"output_saved","agent":"content-intelligence","path":"/outputs/acme-corp/2025-03-23/content-gap-report.json"}
{"timestamp":"2025-03-23T10:01:30.000Z","event":"agent_complete","agent":"content-intelligence","duration_ms":89000}
{"timestamp":"2025-03-23T10:05:00.000Z","event":"file_written","agent":"content-writer","path":"/outputs/acme-corp/2025-03-23/content-draft.md"}
{"timestamp":"2025-03-23T10:10:00.000Z","event":"run_complete","client":"acme-corp","agents_invoked":10}
```

Log events:
- `run_start` / `run_complete` / `run_fatal_error`
- `agent_start` / `agent_complete` / `agent_error`
- `tool_call` — every tool invocation
- `file_written` — every Write/Edit tool call
- `output_saved` — every agent output file
- `brand_voice_cache_hit` / `brand_voice_cached`

## Onboarding a New Client

1. **Create the config file**:
   ```bash
   cp geo-team/clients/example-client.json geo-team/clients/{client-slug}.json
   ```

2. **Edit the config** — Fill in all required fields. Aim for 30+ target queries.

3. **Test with low budget first**:
   ```bash
   # Edit max_budget_usd to 1 for a quick test
   npx ts-node geo-team/run.ts --client {client-slug}
   ```

4. **Review outputs** in `geo-team/outputs/{client-slug}/{date}/`

5. **Check QA status** in `qa-report.json` — if FAIL, review line-level feedback

6. **Cache brand voice** — After first successful run, set `brand_voice_cache` to the generated path:
   ```json
   "brand_voice_cache": "clients/{client-slug}-brand-voice.json"
   ```
   This speeds up future runs and keeps voice consistent.

7. **Schedule recurring runs** — Set up a weekly cron or scheduled task to run visibility monitoring.

## Budget Guidelines

The $5 default budget is allocated approximately:

| Phase | Agent | Budget % |
|-------|-------|----------|
| 1 | content-intelligence | 15% |
| 1 | query-research | 15% |
| 1 | competitor-intelligence | 12% |
| 1 | visibility-monitor | 10% |
| 2 | brand-voice | 6% |
| 3 | citation-builder | 10% |
| 4 | content-writer | 15% |
| 5 | schema-structure | 5% |
| 6 | qa-publish | 10% |
| 7 | reporting | 5% |

For more thorough research, increase `max_budget_usd` to $10-20.

## GEO Technique Reference

Content written by this system applies these AI-citation techniques:

1. **Direct answer structure** — Every section opens with the answer in sentence 1
2. **Entity density** — Client brand/product named explicitly, repeatedly
3. **FAQ sections** — Structured Q&A matching real AI query patterns
4. **Numbered lists** — Sequential processes use numbered steps
5. **Concise definitions** — Key terms defined on first use
6. **TL;DR blocks** — 2-sentence summaries at the top
7. **Authoritative citations** — Statistics from .gov, .edu, or major industry sources
8. **Speakable content** — Key answer sections readable as standalone voice responses
9. **JSON-LD schema** — FAQ, Article, HowTo, BreadcrumbList, Speakable markup
10. **Question headings** — H2/H3 headings that match AI query formats

## Requirements

- Node.js ≥ 18
- `ANTHROPIC_API_KEY` environment variable set
- Claude Code CLI installed (for subagent invocation)
- Internet access for WebSearch and WebFetch tools
