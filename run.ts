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
  agentsInvoked: number;
  totalCostUsd: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global state
// ─────────────────────────────────────────────────────────────────────────────

let runState: RunState;
let logPath: string;

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

function logEvent(event: string, data: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  console.log(JSON.stringify(entry));
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget allocation
// ─────────────────────────────────────────────────────────────────────────────

const BUDCGT_ALLOCATIONS: Record<string, number> = {
  "content-intelligence": 0.15,
  "query-research": 0.15,
  "competitor-intelligence": 0.12,
  "visibility-monitor": 0.10,
  "brand-voice": 0.06,
  "citation-builder": 0.10,
  "content-writer": 0.15,
  "schema-structure": 0.05,
  "qa-publish": 0.10,
  "reporting": 0.05,
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent invocation
// ─────────────────────────────────────────────────────────────────────────────

async function runAgent(
  agentSlug: string,
  prompt: string,
  budgetUsd: number,
  options: {
    cwd?: string;
    systemPromptOverride?: string;
  } = {}
): Promise<string> {
  logEvent("agent_start", { agent: agentSlug, allocated_budget_usd: budgetUsd });

  const startTime = Date.now();
  let fullOutput = "";

  const hooks = {
    onToolCall: ((agent: any, call: any) => {
      logEvent("tool_call", { agent: agentSlug, tool: call.name });
    }) as HookCallback<"beforeToolCall">,
    onToolResult: ((agent: any, result: any) => {
      if (result.output?.startsWith("File written:")) {
        logEvent("file_written", { agent: agentSlug, path: result.output });
      }
    }) as HookCallback<"afterToolResult">,
  };

  const sdkOptions: any = {
    maxTokens: Math.floor(budgetUsd * 100000), // rough token budget
    cwd: options.cwd || process.cwd(),
    hooks: {},
  };

  // Add system prompt override if provided
  if (options.systemPromptOverride) {
    sdkOptions.systemPrompt = options.systemPromptOverride;
  }

  // Run the agent
  for await (const msg of query(prompt, sdkOptions)) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") {
          fullOutput += block.text;
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;
  logEvent("agent_complete", { agent: agentSlug, duration_ms: durationMs });

  return fullOutput;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase executors
// ─────────────────────────────────────────────────────────────────────────────

async function runPhase1(config: ClientConfig, outputDir: string): Promise<void> {
  console.log("\n🚀 Phase 1: Running 4 agents in parallel...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  const [contentGap, queryMap, competitor, visibility] = await Promise.all([
    runAgent(
      "content-intelligence",
      `You are the content-intelligence agent. Analyze the content for:
Domain: ${config.domain}
Niche: ${config.niche}
Target Audience: ${config.target_audience}
Competitors: ${config.competitors.join(", ")}

Perform a comprehensive content audit and gap analysis. Find what topics and questions the client's content is missing that AI engines would need to answer user queries.

Save your output as JSON to: ${outputDir}/content-gap-report.json

The JSON should include: content_gaps, topic_coverage, recommended_topics, priority_scores`,
      maxBudget * BUDGET_ALLOCATIONS["content-intelligence"]
    ),
    runAgent(
      "query-research",
      `You are the query-research agent. Map AI query behavior for:
Domain: ${config.domain}
Niche: ${config.niche}
Target Queries: ${config.target_queries.join("\n")}

Test each query in AI engines (ChatGPT, Perplexity, Claude). Identify what sources are currently being cited and why.

Save your output as JSON to: ${outputDir}/query-opportunity-map.json

The JSON should include: query_results, citation_patterns, opportunities, difficulty_scores`,
      maxBudget * BUDGET_ALLOCATIONS["query-research"]
    ),
    runAgent(
      "competitor-intelligence",
      `You are the competitor-intelligence agent. Analyze competitor AI citations for:
Domain: ${config.domain}
Competitors: ${config.competitors.join(", ")}
Niche: ${config.niche}

Investigate how competitors are appearing in AI answers. What content patterns make them citable?

Save your output as JSON to: ${outputDir}/competitor-report.json

The JSON should include: competitor_analysis, citation_patterns, content_strategies, gap_opportunities`,
      maxBudget * BUDGET_ALLOCATIONS["competitor-intelligence"]
    ),
    runAgent(
      "visibility-monitor",
      `You are the visibility-monitor agent. Track AI visibility for:
Domain: ${config.domain}
Target Queries: ${config.target_queries.join("\n")}
Competitors: ${config.competitors.join(", ")}

Test each target query across ChatGPT, Perplexity, Claude, and Gemini. Measure current visibility scores for client and competitors.

Save your output as JSON to: ${outputDir}/visibility-report.json

The JSON should include: visibility_scores, engine_breakdown, baseline_metrics, competitor_comparison`,
      maxBudget * BUDGET_ALLOCATIONS["visibility-monitor"]
    ),
  ]);

  saveOutput("content-intelligence", `${outputDir}/content-gap-report.json`, contentGap);
  saveOutput("query-research", `${outputDir}/query-opportunity-map.json`, queryMap);
  saveOutput("competitor-intelligence", `${outputDir}/competitor-report.json`, competitor);
  saveOutput("visibility-monitor", `${outputDir}/visibility-report.json`, visibility);
}

async function runPhase2(config: ClientConfig, outputDir: string): Promise<void> {
  console.log("\n👾 Phase 2: Extracting brand voice...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  // Check for cached brand voice
  if (config.brand_voice_cache) {
    const cachePath = path.resolve(__dirname, config.brand_voice_cache);
    if (fs.existsSync(cachePath)) {
      console.log(`Using cached brand voice: ${cachePath}`);
      fs.copyFileSync(cachePath, `${outputDir}/brand-voice.json`);
      logEvent("brand_voice_cache_hit", { path: cachePath });
      return;
    }
  }

  const brandVoice = await runAgent(
    "brand-voice",
    `You are the brand-voice agent. Extract the brand voice for:
Domain: ${config.domain}
Niche: ${config.niche}
Target Audience: ${config.target_audience}

Crawl the client's website and extract their unique brand voice, tone, and messaging patterns.

Save your output as JSON to: ${outputDir}/brand-voice.json

The JSON should include: tone_attributes, voice_examples, key_messaging, avoid_patterns, writing_guidelines`,
    maxBudget * BUDGET_ALLOCATIONS["brand-voice"]
  );

  saveOutput("brand-voice", `${outputDir}/brand-voice.json`, brandVoice);

  // If cache path configured but file doesn't exist yet, save it
  if (config.brand_voice_cache) {
    const cachePath = path.resolve(__dirname, config.brand_voice_cache);
    fs.copyFileSync(`${outputDir}/brand-voice.json`, cachePath);
    logEvent("brand_voice_cached", { path: cachePath });
  }
}

async function runPhase3(config: ClientConfig, outputDir: string): Promise<void> {
  console.log("\n🖷 Phase 3: Building citation package...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  const phase1Outputs = {
    contentGap: fs.readFileSync(`${outputDir}/content-gap-report.json`, "utf8"),
    queryMap: fs.readFileSync(`${outputDir}/query-opportunity-map.json`, "utf8"),
  };

  const citationPackage = await runAgent(
    "citation-builder",
    `You are the citation-builder agent. Research authoritative citations for:
Domain: ${config.domain}
Niche: ${config.niche}

Content Gap Report: ${phase1Outputs.contentGap}

Query Opportunity Map: ${phase1Outputs.queryMap}

Find .gov, .edu, and major industry sources that could be cited in GEO-optimized content.

Save your output as JSON to: ${outputDir}/citation-package.json

The JSON should include: statistics, sources, credibility_scores, usage_guidelines`,
    maxBudget * BUDGET_ALLOCATIONS["citation-builder"]
  );

  saveOutput("citation-builder", `${outputDir}/citation-package.json`, citationPackage);
}

async function runPhase4(config: ClientConfig, outputDir: string): Promise<void> {
  console.log("\n�� Phase 4: Writing GEO content...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  const inputs = {
    contentGap: fs.readFileSync(`${outputDir}/content-gap-report.json`, "utf8"),
    queryMap: fs.readFileSync(`${outputDir}/query-opportunity-map.json`, "utf8"),
    brandVoice: fs.readFileSync(`${outputDir}/brand-voice.json`, "utf8"),
    citations: fs.readFileSync(`${outputDir}/citation-package.json`, "utf8"),
  };

  const contentDraft = await runAgent(
    "content-writer",
    `You are the content-writer agent. Write GEO-optimized content for:
Domain: ${config.domain}
Niche: ${config.niche}
Target Audience: ${config.target_audience}
All target queries: ${config.target_queries.join("\n")}

Content Gap Report: ${inputs.contentGap}
Query Opportunity Map: ${inputs.queryMap}
Brand Voice: ${inputs.brandVoice}
Citation Package: ${inputs.citations}

Apply all 10 GEO techniques:
1. Direct answer structure - Every section opens with the answer in sentence 1
2. Entity density - Client brand/product named explicitly, repeatedly
3. FAQ sections - Structured Q&A matching real AI query patterns
4. Numbered lists - Sequential processes use numbered steps
5. Concise definitions - Key terms defined on first use
6. TL;DR blocks - 2-sentence summaries at the top
7. Authoritative citations - Statistics from .gov, .edu, or major industry sources
8. Speakable content - Key answer sections readable as standalone voice responses
9. JSON-LD schema - FAQ, Article, HowTo, BreadcrumbList, Speakable markup
10. Question headings - H2/H3 headings that match AI query formats

Save your output as markdown to: ${outputDir}/content-draft.md`,
    maxBudget * BUDGET_ALLOCATIONS["content-writer"]
  );

  saveOutput("content-writer", `${outputDir}/content-draft.md`, contentDraft);
}

async function runPhase5(config: ClientConfig, outputDir: string): Promise<void> {
  console.log("\n📒 Phase 5: Generating schema markup...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  const contentDraft = fs.readFileSync(`${outputDir}/content-draft.md`, "utf8");

  const schemaMarkup = await runAgent(
    "schema-structure",
    `You are the schema-structure agent. Generate JSON-LD schema markup for:
Domain: ${config.domain}
Niche: ${config.niche}

Content Draft: ${contentDraft}

Generate comprehensive JSON-LD schema markup including FAQ, Article, HowTo, BreadcrumbList, and Speakable types.

Save your output as JSON to: ${outputDir}/schema-markup.json`,
    maxBudget * BUDGET_ALLOCATIONS["schema-structure"]
  );

  saveOutput("schema-structure", `${outputDir}/schema-markup.json`, schemaMarkup);
}

async function runPhase6(config: ClientConfig, outputDir: string): Promise<void> {
  console.log("\n📅 Phase 6: TA quality check...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  const allOutputs = {
    contentGap: fs.readFileSync(`${outputDir}/content-gap-report.json`, "utf8"),
    queryMap: fs.readFileSync(`${outputDir}/query-opportunity-map.json`, "utf8"),
    competitor: fs.readFileSync(`${outputDir}/competitor-report.json`, "utf8"),
    visibility: fs.readFileSync(`${outputDir}/visibility-report.json`, "utf8"),
    brandVoice: fs.readFileSync(`${outputDir}/brand-voice.json`, "utf8"),
    citations: fs.readFileSync(`${outputDir}/citation-package.json`, "utf8"),
    contentDraft: fs.readFileSync(`${outputDir}/content-draft.md`, "utf8"),
    schemaMarkup: fs.readFileSync(`${outputDir}/schema-markup.json`, "utf8"),
  };

  const qaReport = await runAgent(
    "qa-publish",
    `You are the qa-publish agent. Review all outputs for quality.
Domain: ${config.domain}

Content Gap Report: ${allOutputs.contentGap}

Query Map: ${allOutputs.queryMap}

Competitor Report: ${allOutputs.competitor}

Visibility Report: ${allOutputs.visibility}

Brand Voice: ${allOutputs.brandVoice}

Citation Package: ${allOutputs.citations}

Content Draft: ${allOutputs.contentDraft}

Schema Markup: ${allOutputs.schemaMarkup}

Evaluate each output for quality. Provide PASS/FAIL with line-level feedback.

Save your output as JSON to: ${outputDir}/qa-report.json

The JSON should include: overall_status, agent_scores, feedback_items, recommendations`,
    maxBudget * BUDGET_ALLOCATIONS["qa-publish"]
  );

  saveOutput("qa-publish", `${outputDir}/qa-report.json`, qaReport);
}

async function runPhase7(config: ClientConfig, outputDir: string, clientSlug: string): Promise<void> {
  console.log("\n📋 Phase 7: Generating final report...\n");

  const maxBudget = config.max_budget_usd ?? 5;

  const allOutputs = {
    contentGap: fs.readFileSync(`${outputDir}/content-gap-report.json`, "utf8"),
    queryMap: fs.readFileSync(`${outputDir}/query-opportunity-map.json`, "utf8"),
    competitor: fs.readFileSync(`${outputDir}/competitor-report.json`, "utf8"),
    visibility: fs.readFileSync(`${outputDir}/visibility-report.json`, "utf8"),
    brandVoice: fs.readFileSync(`${outputDir}/brand-voice.json`, "utf8"),
    citations: fs.readFileSync(`${outputDir}/citation-package.json`, "utf8"),
    contentDraft: fs.readFileSync(`${outputDir}/content-draft.md`, "utf8"),
    schemaMarkup: fs.readFileSync(`${outputDir}/schema-markup.json`, "utf8"),
    qaReport: fs.readFileSync(`${outputDir}/qa-report.json`, "utf8"),
  };

  const finalReport = await runAgent(
    "reporting",
    `You are the reporting agent. Generate a comprehensive final report for:
Client: ${clientSlug}
Domain: ${config.domain}
Date: ${runState.date}

Content Gap Report: ${allOutputs.contentGap}

Query Opportunity Map: ${allOutputs.queryMap}

Competitor Report: ${allOutputs.competitor}

Visibility Report: ${allOutputs.visibility}

Brand Voice: ${allOutputs.brandVoice}

Citation Package: ${allOutputs.citations}

Content Draft: ${allOutputs.contentDraft}

Schema Markup: ${allOutputs.schemaMarkup}

QA Report: ${allOutputs.qaReport}

Create a comprehensive markdown report and a JSON summary.

Save markdown to: ${outputDir}/final-report.md
Also save a JSON summary to: ${outputDir}/final-report.json`,
    maxBudget * BUDGET_ALLOCATIONS["reporting"]
  );

  saveOutput("reporting", `${outputDir}/final-report.md`, finalReport);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function saveOutput(agentSlug: string, filePath: string, content: string): void {
  // Try to parse as JSON first (for .json files)
  if (filePath.endsWith(".json")) {
    try {
      JSON.parse(content);
      fs.writeFileSync(filePath, content);
    } catch (e) {
      // Not valid JSON, wrap in a basic structure
      fs.writeFileSync(filePath, JSON.stringify({ raw_output: content }, null, 2));
    }
  } else {
    fs.writeFileSync(filePath, content);
  }
  logEvent("output_saved", { agent: agentSlug, path: filePath });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main runner
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Parse arguments
  const args = process.argv.slice(2);
  const clientIndex = args.indexOf("--client");
  if (clientIndex === -1 || !args[clientIndex + 1]) {
    console.error("Usage: npx ts-node run.ts --client <client-slug>");
    process.exit(1);
  }
  const clientSlug = args[clientIndex + 1];

  // Load config
  const configPath = path.resolve(__dirname, "clients", `${clientSlug}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`Client config not found: ${configPath}`);
    process.exit(1);
  }
  const config: ClientConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

  // Setup output directories
  const today = new Date().toISOString().slice(0, 10);
  const outputDir = path.resolve(__dirname, "outputs", clientSlug, today);
  fs.mkdirSync(outputDir, { recursive: true });

  const logDir = path.resolve(__dirname, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logPath = path.join(logDir, `${today}.jsonl`);

  // Initialize run state
  runState = {
    client: clientSlug,
    date: today,
    outputDir,
    outputs: {},
    agentsInvoked: 0,
    totalCostUsd: 0,
  };

  logEvent("run_start", { client: clientSlug, domain: config.domain });
  console.log(`\n🚀 GEO Agent Team - Starting run for ${clientSlug} (${config.domain})\n`);

  try {
    await runPhase1(config, outputDir);
    await runPhase2(config, outputDir);
    await runPhase3(config, outputDir);
    await runPhase4(config, outputDir);
    await runPhase5(config, outputDir);
    await runPhase6(config, outputDir);
    await runPhase7(config, outputDir, clientSlug);

    logEvent("run_complete", {
      client: clientSlug,
      agents_invoked: runState.agentsInvoked,
      output_dir: outputDir,
    });

    console.log(`\n✅ Run complete! Outputs saved to: ${outputDir}\n`);
  } catch (error) {
    logEvent("run_fatal_error", { client: clientSlug, error: String(error) });
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
