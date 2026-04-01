#!/usr/bin/env npx ts-node
/**
 * GEO Agent Team — Main Orchestrator
 *
 * Usage: npx ts-node geo-team/run.ts --client <client-slug>
 *
 * Runs a full Generative Engine Optimization campaign using parallel
 * and sequential specialist agents. All outputs are saved to
 * geo-team/outputs/{client-slug}/{date}/
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ClientConfig {
  domain: string;
  niche: string;
  target_audience: string;
  competitors: string[];
  target_queries: string[];
  brand_voice_cache?: string; // path to cached brand voice JSON
  max_budget_usd?: number;    // default: 5
}

interface LogEntry {
  timestamp: string;
  event: string;
  agent?: string;
  client?: string;
  [key: string]: unknown;
}

interface RunState {
  client: string;
  date: string;
  outputDir: string;
  outputs: Record<string, string>;
  errors: string[];
  agentInvocations: number;
  totalBudgetUsed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Argument Parsing
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const clientFlagIdx = args.indexOf("--client");

if (clientFlagIdx === -1 || !args[clientFlagIdx + 1]) {
  console.error("❌ Usage: npx ts-node geo-team/run.ts --client <client-slug>");
  console.error("   Example: npx ts-node geo-team/run.ts --client acme-corp");
  process.exit(1);
}

const clientSlug = args[clientFlagIdx + 1];

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Loading
// ─────────────────────────────────────────────────────────────────────────────

const BASE_DIR = path.resolve(__dirname);
const configPath = path.join(BASE_DIR, "clients", `${clientSlug}.json`);

if (!fs.existsSync(configPath)) {
  console.error(`❌ Client config not found: ${configPath}`);
  console.error(`   Create a config file at: geo-team/clients/${clientSlug}.json`);
  console.error("   See geo-team/clients/example-client.json for the schema.");
  process.exit(1);
}

const clientConfig: ClientConfig = JSON.parse(
  fs.readFileSync(configPath, "utf-8")
);

const MAX_BUDGET_USD = clientConfig.max_budget_usd ?? 5;

// ─────────────────────────────────────────────────────────────────────────────
// Output & Log Setup
// ─────────────────────────────────────────────────────────────────────────────

const runDate = new Date().toISOString().split("T")[0];
const outputDir = path.join(BASE_DIR, "outputs", clientSlug, runDate);
const logFile = path.join(BASE_DIR, "logs", `${runDate}.jsonl`);

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(logFile), { recursive: true });

const state: RunState = {
  client: clientSlug,
  date: runDate,
  outputDir,
  outputs: {},
  errors: [],
  agentInvocations: 0,
  totalBudgetUsed: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

function writeLog(entry: Omit<LogEntry, "timestamp">): void {
  const logLine: LogEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(logFile, JSON.stringify(logLine) + "\n");
}

function printPhase(phase: number, name: string): void {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Phase ${phase}: ${name}`);
  console.log(`${"─".repeat(60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget Guard
// ─────────────────────────────────────────────────────────────────────────────

function getRemainingBudget(): number {
  return Math.max(0, MAX_BUDGET_USD - state.totalBudgetUsed);
}

function allocateBudget(requested: number): number {
  const available = getRemainingBudget();
  if (available <= 0) {
    throw new Error(`Budget exhausted. Max: $${MAX_BUDGET_USD}, Spent: $${state.totalBudgetUsed.toFixed(4)}`);
  }
  return Math.min(requested, available);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Factories
// ─────────────────────────────────────────────────────────────────────────────

function makeToolLogHook(agentName: string): HookCallback {
  return async (input, _toolUseId, _opts) => {
    const toolName = (input as Record<string, unknown>).tool_name as string ?? "unknown";
    writeLog({ event: "tool_call", agent: agentName, tool: toolName, client: clientSlug });
    return {};
  };
}

function makeWriteLogHook(agentName: string): HookCallback {
  return async (input, _toolUseId, _opts) => {
    const toolInput = (input as Record<string, unknown>).tool_input as Record<string, unknown>;
    const filePath = toolInput?.file_path as string ?? toolInput?.path as string;
    if (filePath) {
      writeLog({ event: "file_written", agent: agentName, path: filePath, client: clientSlug });
    }
    return {};
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Agent Runner
// ─────────────────────────────────────────────────────────────────────────────

interface AgentRunOptions {
  agentName: string;
  prompt: string;
  model: "claude-opus-4-6" | "claude-sonnet-4-6" | "claude-haiku-4-5-20251001";
  tools: string[];
  budgetUsd: number;
  outputFile?: string;
  systemPrompt?: string;
}

async function runAgent(opts: AgentRunOptions): Promise<string> {
  const { agentName, prompt, model, tools, outputFile, systemPrompt } = opts;

  const allocatedBudget = allocateBudget(opts.budgetUsd);
  const startTime = Date.now();

  state.agentInvocations++;

  writeLog({
    event: "agent_start",
    agent: agentName,
    client: clientSlug,
    model,
    tools,
    allocated_budget_usd: allocatedBudget,
    invocation_number: state.agentInvocations,
  });

  console.log(`  ▶ ${agentName} [${model}]`);

  let result = "";

  try {
    for await (const message of query({
      prompt,
      options: {
        model,
        allowedTools: tools,
        maxBudgetUsd: allocatedBudget,
        cwd: outputDir,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(systemPrompt ? { systemPrompt } : {}),
        hooks: {
          PreToolUse: [
            { matcher: ".*", hooks: [makeToolLogHook(agentName)] },
          ],
          PostToolUse: [
            { matcher: "Write|Edit", hooks: [makeWriteLogHook(agentName)] },
          ],
        },
      },
    })) {
      if (message.type === "result") {
        if (message.subtype === "success") {
          result = message.result;
        }
        state.totalBudgetUsed += message.total_cost_usd ?? 0;
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    state.errors.push(`${agentName}: ${errMsg}`);
    writeLog({ event: "agent_error", agent: agentName, error: errMsg });
    console.error(`  ✗ ${agentName} error: ${errMsg}`);
    return `ERROR: ${errMsg}`;
  }

  const durationMs = Date.now() - startTime;

  // Persist output to file
  if (outputFile && result) {
    const fullOutputPath = path.join(outputDir, outputFile);
    fs.writeFileSync(fullOutputPath, result, "utf-8");
    state.outputs[agentName] = fullOutputPath;
    writeLog({
      event: "output_saved",
      agent: agentName,
      path: fullOutputPath,
      client: clientSlug,
    });
  }

  writeLog({
    event: "agent_complete",
    agent: agentName,
    client: clientSlug,
    duration_ms: durationMs,
    output_file: outputFile ?? null,
    result_length: result.length,
  });

  const resultPreview = result.slice(0, 80).replace(/\n/g, " ");
  console.log(`  ✓ ${agentName} (${(durationMs / 1000).toFixed(1)}s) → ${resultPreview}…`);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safely truncate agent output to avoid exceeding context limits */
function ctx(text: string, maxChars = 2000): string {
  if (text.startsWith("ERROR:")) return text;
  return text.length > maxChars ? text.slice(0, maxChars) + "\n... [truncated]" : text;
}

/** Load cached brand voice if available */
function loadBrandVoiceCache(): string | null {
  if (clientConfig.brand_voice_cache) {
    const cachePath = path.isAbsolute(clientConfig.brand_voice_cache)
      ? clientConfig.brand_voice_cache
      : path.join(BASE_DIR, clientConfig.brand_voice_cache);
    if (fs.existsSync(cachePath)) {
      return fs.readFileSync(cachePath, "utf-8");
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Orchestration
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { domain, niche, target_audience, competitors, target_queries } = clientConfig;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(`║  GEO Agent Team — ${clientSlug.padEnd(40)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  Domain:   ${domain}`);
  console.log(`  Niche:    ${niche}`);
  console.log(`  Budget:   $${MAX_BUDGET_USD}`);
  console.log(`  Outputs:  ${outputDir}`);
  console.log(`  Logs:     ${logFile}`);

  writeLog({ event: "run_start", client: clientSlug, domain, niche, max_budget_usd: MAX_BUDGET_USD });

  const querySample = target_queries.slice(0, 30);
  const competitorList = competitors.slice(0, 5);

  // ── Phase 1: Parallel Research ──────────────────────────────────────────

  printPhase(1, "Parallel Research (content-intelligence + query-research + competitor-intelligence + visibility-monitor)");

  const [
    contentIntelResult,
    queryResearchResult,
    competitorResult,
    visibilityResult,
  ] = await Promise.all([

    runAgent({
      agentName: "content-intelligence",
      model: "claude-sonnet-4-6",
      tools: ["Read", "WebSearch", "WebFetch"],
      budgetUsd: MAX_BUDGET_USD * 0.15,
      outputFile: "content-gap-report.json",
      prompt: `You are the content-intelligence GEO agent.

Client domain: ${domain}
Niche: ${niche}
Target audience: ${target_audience}

Audit the content at ${domain}:
1. Use WebFetch to retrieve the homepage, sitemap (try /sitemap.xml), and any blog/resources index
2. Identify all topics currently covered, thin content areas, and major gaps
3. Analyze what content formats AI engines tend to cite in the ${niche} space
4. Use WebSearch to research what top competitors cover in this niche

Output a structured JSON content gap report following this schema:
{
  "domain": "${domain}",
  "audit_date": "YYYY-MM-DD",
  "content_inventory": { "topics_covered": [], "content_formats": {} },
  "thin_content_areas": [],
  "missing_topics": [],
  "high_value_gaps": [{ "topic": "", "priority": "", "recommended_format": "", "ai_citation_likelihood": 0, "rationale": "" }],
  "ai_citation_readiness_score": 0,
  "top_3_quick_wins": [],
  "recommendations": []
}`,
    }),

    runAgent({
      agentName: "query-research",
      model: "claude-sonnet-4-6",
      tools: ["Read", "WebSearch", "WebFetch"],
      budgetUsd: MAX_BUDGET_USD * 0.15,
      outputFile: "query-opportunity-map.json",
      prompt: `You are the query-research GEO agent.

Client domain: ${domain}
Niche: ${niche}
Target queries to test: ${JSON.stringify(querySample)}

For each query (test as many as budget allows):
1. Use WebSearch to run the query
2. Record whether an AI overview/generated answer is present
3. Note which brands/domains appear in AI answers
4. Identify language patterns and content formats cited

Output a query opportunity map JSON:
{
  "domain": "${domain}",
  "niche": "${niche}",
  "research_date": "YYYY-MM-DD",
  "queries_tested": 0,
  "query_opportunity_map": [
    {
      "query": "",
      "ai_overview_triggered": true,
      "ai_answer_format": "",
      "cited_domains": [],
      "client_currently_cited": false,
      "opportunity_score": 0,
      "recommended_content_approach": ""
    }
  ],
  "top_10_opportunities": [],
  "dominant_cited_competitors": [],
  "strategic_insights": []
}`,
    }),

    runAgent({
      agentName: "competitor-intelligence",
      model: "claude-sonnet-4-6",
      tools: ["Read", "WebSearch", "WebFetch"],
      budgetUsd: MAX_BUDGET_USD * 0.12,
      outputFile: "competitor-report.json",
      prompt: `You are the competitor-intelligence GEO agent.

Client domain: ${domain}
Niche: ${niche}
Competitor domains to analyze: ${JSON.stringify(competitorList)}

For each competitor:
1. Use WebFetch to check their content index/blog
2. Use WebSearch to test niche queries and see if they appear in AI answers
3. Identify their dominant topics and AI citation patterns
4. Find their exploitable weaknesses

Output a competitive threat and opportunity report JSON:
{
  "client_domain": "${domain}",
  "analysis_date": "YYYY-MM-DD",
  "competitor_profiles": [
    {
      "domain": "",
      "dominant_topics": [],
      "ai_visibility_score": 0,
      "ai_cited_pages": [],
      "exploitable_weaknesses": []
    }
  ],
  "competitive_landscape_summary": {
    "strongest_competitor": "",
    "biggest_collective_blindspot": "",
    "topics_client_can_win": []
  },
  "priority_opportunities": []
}`,
    }),

    runAgent({
      agentName: "visibility-monitor",
      model: "claude-sonnet-4-6",
      tools: ["Read", "WebSearch", "WebFetch"],
      budgetUsd: MAX_BUDGET_USD * 0.10,
      outputFile: "visibility-report.json",
      prompt: `You are the visibility-monitor GEO agent.

Client domain: ${domain}
Niche: ${niche}
Target queries: ${JSON.stringify(querySample)}

Run a visibility sweep:
1. Use WebSearch to test each query
2. For each query, check if ${domain} appears in AI-generated answers
3. Record which competitors appear instead
4. Calculate visibility score

Output a visibility score and trend report JSON:
{
  "client_domain": "${domain}",
  "sweep_date": "YYYY-MM-DD",
  "queries_tested": 0,
  "results": [
    {
      "query": "",
      "ai_overview_present": true,
      "client_cited": false,
      "competitors_cited": [],
      "opportunity_flag": "open|displace|optimize|defend|none"
    }
  ],
  "visibility_scores": {
    "raw_visibility_rate": 0,
    "ai_overview_rate": 0,
    "composite_visibility_score": 0
  },
  "opportunities": { "open_territory": [], "displacement_targets": [] },
  "recommendations": []
}`,
    }),
  ]);

  // ── Phase 2: Brand Voice ─────────────────────────────────────────────────

  printPhase(2, "Brand Voice Extraction");

  // Use cache if available, otherwise run the agent
  const cachedBrandVoice = loadBrandVoiceCache();
  let brandVoiceResult: string;

  if (cachedBrandVoice) {
    brandVoiceResult = cachedBrandVoice;
    console.log("  ✓ brand-voice [cached]");
    writeLog({ event: "brand_voice_cache_hit", client: clientSlug, domain });
  } else {
    brandVoiceResult = await runAgent({
      agentName: "brand-voice",
      model: "claude-haiku-4-5-20251001",
      tools: ["Read", "WebSearch", "WebFetch"],
      budgetUsd: MAX_BUDGET_USD * 0.06,
      outputFile: "brand-voice.json",
      prompt: `You are the brand-voice GEO agent.

Client domain: ${domain}
Niche: ${niche}

Extract the brand voice by:
1. Using WebFetch to retrieve the homepage, about page, and 2-3 blog posts from ${domain}
2. Analyzing tone, reading level, vocabulary preferences, structure preferences

Output a brand voice guide JSON:
{
  "domain": "${domain}",
  "extracted_date": "YYYY-MM-DD",
  "cache_ttl_days": 30,
  "tone_profile": { "formality": 0, "technicality": 0, "overall_description": "" },
  "reading_level": { "grade_level": 0, "audience_sophistication": "" },
  "vocabulary": { "preferred_terms": {}, "avoided_terms": [], "customer_reference": "" },
  "structure_preferences": { "heading_style": "", "list_preference": "" },
  "do_use": [],
  "do_not_use": [],
  "sample_phrases": [],
  "writing_instructions": ""
}`,
    });

    // Cache for future runs
    const brandVoiceCachePath = path.join(BASE_DIR, "clients", `${clientSlug}-brand-voice.json`);
    if (brandVoiceResult && !brandVoiceResult.startsWith("ERROR:")) {
      fs.writeFileSync(brandVoiceCachePath, brandVoiceResult, "utf-8");
      writeLog({ event: "brand_voice_cached", path: brandVoiceCachePath });
    }
  }

  // ── Phase 3: Citation Building ───────────────────────────────────────────

  printPhase(3, "Citation Building");

  const citationResult = await runAgent({
    agentName: "citation-builder",
    model: "claude-sonnet-4-6",
    tools: ["Read", "WebSearch", "WebFetch"],
    budgetUsd: MAX_BUDGET_USD * 0.10,
    outputFile: "citation-package.json",
    prompt: `You are the citation-builder GEO agent.

Client domain: ${domain}
Niche: ${niche}

Content gap context (abbreviated):
${ctx(contentIntelResult, 1000)}

Query opportunities context (abbreviated):
${ctx(queryResearchResult, 800)}

Find authoritative citations for content about ${niche}:
1. Use WebSearch to find recent statistics, academic studies, and industry reports
2. Find expert quotes that can be attributed to real people
3. Identify the most authoritative non-competitor domains in this niche
4. Verify all URLs are accessible with WebFetch

Output a citation package JSON:
{
  "domain": "${domain}",
  "niche": "${niche}",
  "research_date": "YYYY-MM-DD",
  "statistics": [
    { "stat": "", "source_name": "", "source_url": "", "publication_date": "", "credibility_tier": "", "supports_topic": "" }
  ],
  "research_studies": [],
  "expert_quotes": [],
  "authority_domains": [],
  "citation_summary": ""
}`,
  });

  // ── Phase 4: Content Writing ─────────────────────────────────────────────

  printPhase(4, "GEO Content Writing");

  const contentResult = await runAgent({
    agentName: "content-writer",
    model: "claude-sonnet-4-6",
    tools: ["Read", "WebSearch", "WebFetch", "Write"],
    budgetUsd: MAX_BUDGET_USD * 0.15,
    outputFile: "content-draft.md",
    prompt: `You are the content-writer GEO agent.

Client domain: ${domain}
Niche: ${niche}
Target audience: ${target_audience}

Research inputs:
CONTENT GAP REPORT: ${ctx(contentIntelResult, 800)}
TOP QUERY OPPORTUNITIES: ${ctx(queryResearchResult, 800)}
BRAND VOICE GUIDE: ${ctx(brandVoiceResult, 600)}
CITATION PACKAGE: ${ctx(citationResult, 800)}

Write one complete GEO-optimized content piece for ${domain}:

REQUIREMENTS:
1. Open each major section with a direct answer (first sentence answers the implied question)
2. Mention ${domain} and key product/service entities explicitly in the first 100 words
3. Include a TL;DR block (2 sentences) at the top
4. Include a dedicated FAQ section with 5-8 Q&A pairs matching real search queries
5. Use numbered lists for any sequential processes
6. Include at least one comparison table if applicable
7. Define key industry terms on first use
8. Embed 2-3 statistics from the citation package with full attribution
9. Target 1,500-2,500 words

Write the content in the brand voice described in the brand voice guide.
Save the complete article as "content-draft.md" in the current directory.

Begin the file with YAML frontmatter:
---
title: ""
target_queries: []
client: "${domain}"
geo_techniques_applied: []
---`,
  });

  // ── Phase 5: Schema Markup ───────────────────────────────────────────────

  printPhase(5, "Schema & Structure Generation");

  const schemaResult = await runAgent({
    agentName: "schema-structure",
    model: "claude-haiku-4-5-20251001",
    tools: ["Read", "WebSearch", "WebFetch"],
    budgetUsd: MAX_BUDGET_USD * 0.05,
    outputFile: "schema-markup.json",
    prompt: `You are the schema-structure GEO agent.

Generate JSON-LD structured data markup for this GEO content:

${ctx(contentResult, 3000)}

Generate:
1. FAQPage schema (extract all Q&A pairs from the content)
2. Article schema (full markup)
3. BreadcrumbList schema for ${domain}
4. HowTo schema if the content has step-by-step instructions
5. Speakable schema for key answer sections

Also provide:
- Heading hierarchy analysis
- 3 top extractable passages for AI engines
- Optimal answer block (1-3 sentences most likely to appear in AI overview)

Output as JSON:
{
  "generated_date": "YYYY-MM-DD",
  "schema_blocks": { "faq_schema": {}, "article_schema": {}, "howto_schema": null, "breadcrumb_schema": {}, "speakable_schema": {} },
  "heading_audit": { "current_structure": [], "violations": [], "recommendations": [] },
  "ai_extraction_analysis": { "top_extractable_passages": [], "optimal_answer_block": "", "ai_citation_likelihood_score": 0 }
}`,
  });

  // ── Phase 6: QA Review ───────────────────────────────────────────────────

  printPhase(6, "QA & Publish Gating");

  const qaResult = await runAgent({
    agentName: "qa-publish",
    model: "claude-sonnet-4-6",
    tools: ["Read", "WebSearch", "WebFetch", "Write"],
    budgetUsd: MAX_BUDGET_USD * 0.10,
    outputFile: "qa-report.json",
    prompt: `You are the qa-publish GEO agent.

Review the following content for GEO compliance and quality.

CONTENT DRAFT:
${ctx(contentResult, 3000)}

SCHEMA MARKUP:
${ctx(schemaResult, 800)}

CITATION PACKAGE:
${ctx(citationResult, 600)}

BRAND VOICE GUIDE:
${ctx(brandVoiceResult, 400)}

Perform a complete QA review:
1. Factual accuracy check (spot-check 2-3 statistics with WebSearch/WebFetch)
2. Citation integrity (verify 2-3 URLs are accessible)
3. Brand voice compliance score (1-10)
4. GEO formatting compliance checklist
5. Schema markup validity check

Return JSON:
{
  "overall_result": "PASS|FAIL",
  "overall_score": 0,
  "critical_failures": [],
  "section_scores": { "factual_accuracy": 0, "citation_integrity": 0, "brand_voice_compliance": 0, "geo_formatting": 0, "schema_validity": 0 },
  "geo_checklist": { "direct_answer_opening": true, "entity_density": true, "faq_section": true, "numbered_lists": true, "tldr_block": true, "external_citations": true },
  "line_level_feedback": [{ "section": "", "issue": "", "severity": "critical|major|minor", "suggested_fix": "" }],
  "must_fix_before_publish": [],
  "publish_recommendation": "publish|revise|reject"
}

Save the QA report as "qa-report.json".`,
  });

  // ── Phase 7: Final Report ────────────────────────────────────────────────

  printPhase(7, "Final Report Generation");

  const reportResult = await runAgent({
    agentName: "reporting",
    model: "claude-haiku-4-5-20251001",
    tools: ["Read", "WebSearch", "WebFetch"],
    budgetUsd: MAX_BUDGET_USD * 0.05,
    outputFile: "final-report.md",
    prompt: `You are the reporting GEO agent.

Generate a comprehensive GEO campaign report for ${domain}.

DATA INPUTS:
Content Gap Report: ${ctx(contentIntelResult, 600)}
Query Opportunity Map: ${ctx(queryResearchResult, 600)}
Competitor Report: ${ctx(competitorResult, 600)}
Visibility Report: ${ctx(visibilityResult, 600)}
QA Result: ${ctx(qaResult, 400)}

Generate TWO files:

1. "final-report.md" — A polished markdown report with:
   - Executive summary (3-5 sentences)
   - AI Visibility Performance table (with scores from visibility report)
   - Content produced this run
   - Top 3 competitive threats
   - Top 5 opportunities
   - Recommended next actions (priority ordered)
   - Budget summary

2. Also return a JSON payload for dashboard ingestion:
{
  "report_metadata": { "client_domain": "${domain}", "run_date": "${runDate}", "agents_run": [] },
  "visibility_scores": { "composite_score": 0, "visibility_rate": 0 },
  "content_pipeline": { "pieces_produced": 0, "pieces_passing_qa": 0 },
  "query_performance": { "total_tracked": 0, "client_cited_count": 0 },
  "recommended_actions": [{ "priority": 1, "action": "", "expected_impact": "", "effort": "low|medium|high" }]
}

Use actual numbers and findings from the data inputs provided.`,
  });

  // Save JSON payload separately
  const jsonMatch = reportResult.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    const jsonPayloadPath = path.join(outputDir, "final-report.json");
    fs.writeFileSync(jsonPayloadPath, jsonMatch[1], "utf-8");
    writeLog({ event: "output_saved", agent: "reporting", path: jsonPayloadPath });
  }

  // ── Run Complete ─────────────────────────────────────────────────────────

  const qaPass = qaResult.includes('"PASS"') || qaResult.includes("PASS");
  const runSummary = {
    client: clientSlug,
    domain,
    date: runDate,
    output_dir: outputDir,
    log_file: logFile,
    agents_invoked: state.agentInvocations,
    errors: state.errors.length,
    qa_status: qaPass ? "PASS" : "FAIL",
    files_produced: fs.readdirSync(outputDir).length,
  };

  writeLog({ event: "run_complete", ...runSummary });

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  GEO Agent Team Run Complete                             ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  ✓ Client:       ${clientSlug}`);
  console.log(`  ✓ Agents run:   ${state.agentInvocations}`);
  console.log(`  ✓ QA Status:    ${qaPass ? "✅ PASS" : "⚠️  FAIL — review qa-report.json"}`);
  console.log(`  ✓ Outputs:      ${outputDir}`);
  console.log(`  ✓ Files:        ${runSummary.files_produced} files produced`);
  console.log(`  ✓ Logs:         ${logFile}`);

  if (state.errors.length > 0) {
    console.log(`\n  ⚠️  Errors encountered (${state.errors.length}):`);
    state.errors.forEach((e) => console.log(`     - ${e}`));
  }

  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Point
// ─────────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  const errMsg = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ Fatal error: ${errMsg}`);
  writeLog({ event: "run_fatal_error", error: errMsg, client: clientSlug });
  process.exit(1);
});
