/**
 * Shared Anthropic API client for the builder-enrichment + pitch-generator
 * agents. Lives at src/lib/agents/claude-client.ts.
 *
 * Wraps @anthropic-ai/sdk with:
 *   - Prompt caching on the system prompt (5-min ephemeral TTL by default)
 *   - Manual tool-use loop with iteration cap + truncation surface
 *   - Cost tracking (input cached / uncached / cache-write / output)
 *   - Default model: claude-sonnet-4-6 with effort=medium
 *     (per repo CLAUDE.md "default to Sonnet" + $400/mo budget cap)
 *   - Tool-call audit trail for runlog.jsonl
 *
 * NOT a replacement for src/lib/claude.ts — that's the staff-AI chat wrapper
 * (still on claude-sonnet-4-5, raw fetch). This is dedicated to autonomous
 * agents with tighter cost controls + prompt caching.
 *
 * USAGE:
 *   const result = await runAgent({
 *     systemPrompt: enrichCriteriaMd,   // CACHED — keep frozen across calls
 *     userMessage: `Builder: "${name}" (DFW)`,
 *     serverTools: [
 *       { type: 'web_search_20260209', name: 'web_search' },
 *       { type: 'web_fetch_20260209',  name: 'web_fetch'  },
 *     ],
 *     tools: [exaSearchTool],            // custom tools defined in src/lib/agents/tools/
 *     executeTool: async (name, input) => { ... },
 *   })
 *
 * COST: With prompt caching, repeated calls with the same systemPrompt see
 * ~90% reduction on the cached portion. Verify via result.cachedInputTokens.
 */

import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'

// ── Defaults ───────────────────────────────────────────────────────────────
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_MAX_ITERATIONS = 12

// ── Pricing (Sonnet 4.6, per token) — as of 2026-04-30 ────────────────────
// Update if pricing changes. Used for costUsd estimates only — for hard caps,
// use the per-job budget guard in the cron handler.
const PRICE_INPUT_UNCACHED    = 3.0  / 1_000_000  // $3.00 / MTok
const PRICE_INPUT_CACHE_READ  = 0.30 / 1_000_000  // $0.30 / MTok (10% of base)
const PRICE_INPUT_CACHE_WRITE = 3.75 / 1_000_000  // $3.75 / MTok (1.25× base, 5-min TTL)
const PRICE_OUTPUT            = 15.0 / 1_000_000  // $15.00 / MTok

// ── Singleton client ──────────────────────────────────────────────────────
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (_client) return _client
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not set — required for builder-enrichment + pitch-generator agents'
    )
  }
  _client = new Anthropic({ apiKey })
  return _client
}

// ── Public types ──────────────────────────────────────────────────────────
export interface AgentToolCall {
  name: string
  input: Record<string, unknown>
  output: string
  isError?: boolean
}

export interface AgentRunResult {
  text: string
  toolCalls: AgentToolCall[]
  truncated: boolean
  iterations: number
  costUsd: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  stopReason: string | null
}

export interface AgentRunInput {
  /** System prompt — cached. Keep frozen across calls (no timestamps, IDs). */
  systemPrompt: string
  /** User message kicking off the turn. */
  userMessage: string
  /** Custom (client-side) tool definitions. */
  tools?: Anthropic.Tool[]
  /** Server-side tools — e.g. `{type: 'web_search_20260209', name: 'web_search'}`. */
  serverTools?: Array<{ type: string; name: string; [k: string]: unknown }>
  /** Tool executor. Required if any custom tools are provided. */
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<string>
  /** Override defaults. */
  model?: string
  maxTokens?: number
  maxIterations?: number
  /** Effort level (Sonnet 4.6 supports low|medium|high; default: medium). */
  effort?: 'low' | 'medium' | 'high'
  /** Optional caller for runlog.jsonl tagging. */
  caller?: string
}

/**
 * Run an agent turn with prompt caching, tool use, and cost tracking.
 *
 * The system prompt is wrapped in a cache_control: ephemeral block so
 * subsequent calls with the same systemPrompt see ~90% input cost reduction.
 * Verify by checking `result.cachedInputTokens` is non-zero on the 2nd+ call.
 */
export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const {
    systemPrompt,
    userMessage,
    tools = [],
    serverTools = [],
    executeTool,
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    effort = 'medium',
    caller = 'unknown',
  } = input

  const client = getClient()
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ]
  const toolCalls: AgentToolCall[] = []

  let inputTokens = 0
  let cachedInputTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let lastText = ''
  let lastStopReason: string | null = null
  let iterations = 0

  while (iterations < maxIterations) {
    iterations++

    // Build request body. Cast through `any` for fields the SDK 0.32 types
    // may not fully expose yet (output_config, server-side tool unions).
    const body: any = {
      model,
      max_tokens: maxTokens,
      // Prompt caching: cache the system prompt with 5-min ephemeral TTL.
      // Keep `systemPrompt` byte-stable — any change invalidates the cache.
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
      tools: [...tools, ...serverTools],
      output_config: { effort },
    }

    let response: Anthropic.Message
    try {
      response = await client.messages.create(body)
    } catch (err: any) {
      logger.error('agent_run_request_failed', err, { caller, iterations, model })
      throw err
    }

    // Tally usage (cache fields are optional in the typed Usage)
    inputTokens += response.usage.input_tokens
    cachedInputTokens += (response.usage as any).cache_read_input_tokens || 0
    cacheWriteTokens += (response.usage as any).cache_creation_input_tokens || 0
    outputTokens += response.usage.output_tokens
    lastStopReason = response.stop_reason as string | null

    // Capture text from this iteration (so truncation still surfaces partial answers)
    const partialText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (partialText) lastText = partialText

    // Tool use → execute → loop
    if (response.stop_reason === 'tool_use' && executeTool) {
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          try {
            const out = await executeTool(
              block.name,
              (block.input || {}) as Record<string, unknown>
            )
            toolCalls.push({
              name: block.name,
              input: (block.input || {}) as Record<string, unknown>,
              output: out,
            })
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: out,
            })
          } catch (err: any) {
            const msg = err?.message ?? String(err)
            toolCalls.push({
              name: block.name,
              input: (block.input || {}) as Record<string, unknown>,
              output: `Error: ${msg}`,
              isError: true,
            })
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${msg}`,
              is_error: true,
            })
          }
        }
      }
      messages.push({ role: 'user', content: results })
      continue
    }

    // Server-side tool pause (e.g., web_search hit its iteration cap).
    // SDK 0.24's stop_reason union doesn't include 'pause_turn' yet — gets
    // added in 0.30+. Cast to bypass the union check; the runtime value is
    // correct on Sonnet 4.6 server-tool calls regardless of typed SDK version.
    if ((response.stop_reason as string) === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content })
      // Re-send to resume — server detects the trailing server_tool_use block
      continue
    }

    // Final answer — return
    return {
      text: lastText,
      toolCalls,
      truncated: false,
      iterations,
      costUsd: estimateCost({ inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens }),
      inputTokens,
      cachedInputTokens,
      outputTokens,
      stopReason: lastStopReason,
    }
  }

  // Iteration cap hit — surface partial state
  logger.warn('agent_run_truncated', { caller, iterations, model })
  return {
    text:
      lastText ||
      'Agent loop hit iteration cap before producing a final answer. Try a tighter scope or higher maxIterations.',
    toolCalls,
    truncated: true,
    iterations,
    costUsd: estimateCost({ inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens }),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    stopReason: lastStopReason,
  }
}

// ── Cost estimator ────────────────────────────────────────────────────────
function estimateCost(opts: {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
}): number {
  // input_tokens is the UNCACHED remainder; cache_read/cache_creation are
  // separate counters that don't double-count.
  return (
    opts.inputTokens * PRICE_INPUT_UNCACHED +
    opts.cachedInputTokens * PRICE_INPUT_CACHE_READ +
    opts.cacheWriteTokens * PRICE_INPUT_CACHE_WRITE +
    opts.outputTokens * PRICE_OUTPUT
  )
}

// ── Per-job budget guard ──────────────────────────────────────────────────
/**
 * Throws if the per-job cost cap is exceeded. Use to bound a single agent
 * run from runaway tool-loop spend.
 *
 *   const guard = makeBudgetGuard({ capUsd: 1.0 })
 *   guard(result.costUsd)  // throws if > $1
 */
export function makeBudgetGuard(opts: { capUsd: number }) {
  return (currentUsd: number) => {
    if (currentUsd > opts.capUsd) {
      throw new Error(
        `Per-job budget cap exceeded: $${currentUsd.toFixed(4)} > $${opts.capUsd}`
      )
    }
  }
}
