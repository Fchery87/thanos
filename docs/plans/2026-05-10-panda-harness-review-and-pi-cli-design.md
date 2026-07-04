# Panda Harness: Comprehensive Technical Review & Pi.dev CLI Design Plan

## Context

This document is a research deliverable, not yet an implementation plan. The goal is:

1. A thorough, authoritative technical description of the Panda Agentic Harness — suitable for engineering handoff, OSS documentation, or a design brief for a CLI port.
2. A clear-eyed overview of the Pi.dev platform and how it compares to the Panda harness model.
3. A concrete strategy for building a terminal CLI tool powered by Pi.dev that wraps or reimplements the Panda Harness execution model.

No code is being modified. This is a planning artifact.

---

# Part I — The Panda Agentic Harness: Comprehensive Technical Review

## 1. What Is the Harness?

The Panda Agentic Harness (`apps/web/lib/agent/harness/`) is a production-grade, multi-step LLM agent runtime built in TypeScript. It orchestrates entire agentic runs from user prompt intake through tool execution, context compaction, permission enforcement, spec verification, and checkpoint persistence — all exposed as a streaming `AsyncGenerator<RuntimeEvent>` that callers consume in real time.

It is architecturally inspired by OpenCode but extended significantly for Panda's web-first, Convex-backed model: a live browser runtime (WebContainer), spec-native specification tracking, git-tree-based snapshots, subagent delegation, and a two-layer permission model with audit logging.

The harness is intentionally decoupled from React. The UI layer (`useAgent.ts`) consumes it via async iteration; the harness itself has no React dependencies. This decoupling makes it the most natural candidate for extraction into a CLI tool.

---

## 2. File Architecture

### 2.1 Core Execution
| File | Role |
|------|------|
| `runtime.ts` (89KB) | The entire execution engine: step loop, tool dispatch, streaming, compaction, permission enforcement, snapshot capture, checkpoint persistence |
| `types.ts` (14KB) | All TypeScript types: `Message`, `Part`, `AgentConfig`, `RuntimeConfig`, `RuntimeEvent`, `ToolExecutionContext`, `RuntimeState` |
| `index.ts` (3KB) | Public exports: `createRuntime`, plugin registry, event bus singleton |

### 2.2 Agents & Permissions
| File | Role |
|------|------|
| `agents.ts` (24KB) | Built-in agent definitions (build, code, plan, ask) + markdown frontmatter parser for custom agents |
| `permissions.ts` (9KB) | `PermissionManager` class: session-scoped decisions, event-bus-based approval requests, audit logging |
| `permission/types.ts` | Capability-based permission rule types: `Capability`, `PermissionRule`, `PermissionContext` |
| `permission/evaluate.ts` | Rule evaluation (last-rule-wins) + subagent capability narrowing |
| `permission/wildcard.ts` | Glob pattern matching with specificity sorting |
| `permission/legacy-adapter.ts` | Backward-compat shim for old `{tool: decision}` format |

### 2.3 Context & History
| File | Role |
|------|------|
| `compaction.ts` (9KB) | Token estimation + LLM-based context summarization at 90% threshold |
| `checkpoint-store.ts` (3KB) | `CheckpointStore` interface + `InMemoryCheckpointStore` |
| `convex-checkpoint-store.ts` | Production Convex backend for checkpoint persistence |
| `runtime-checkpoint.ts` (4KB) | State serialization helpers (Map→Array for JSON, legacy migration) |

### 2.4 Tool Execution Infrastructure
| File | Role |
|------|------|
| `tool-scheduling.ts` (3KB) | Parallel vs. sequential tool planning, deduplication, max-per-step limiting |
| `tool-repair.ts` (6KB) | Fuzzy tool name matching + JSON argument repair for malformed LLM outputs |
| `runtime-tools.ts` (2KB) | Utility functions: retry detection, deduplication key generation |
| `task-tool.ts` (10KB) | The `task` built-in tool: subagent delegation with permission narrowing, 21 subagent types |

### 2.5 Tool Call Grammars
| File | Role |
|------|------|
| `tool-call-grammars/index.ts` | Grammar registry keyed by provider+model |
| `tool-call-grammars/anthropic-xml-fallback.ts` | Extract leaked `<tool_call>` XML from text stream |
| `tool-call-grammars/openai-text-json.ts` | OpenAI JSON format extraction |
| `tool-call-grammars/deepseek-fim.ts` | DeepSeek FIM format extraction |
| `tool-call-grammars/minimax-xml.ts` | Minimax XML format extraction |
| `stream-sanitizer.ts` (2KB) | Detects undeclared grammar leakage in text output |

### 2.6 Extensibility & Events
| File | Role |
|------|------|
| `plugins.ts` (10KB) | `PluginManager`: hook registration, custom tool/agent registration, `registerDefaultPlugins()` |
| `event-bus.ts` (5KB) | Centralized pub/sub with 1000-event history, filtering, auto-replay |
| `mcp.ts` (14KB) | MCP client abstraction: `MCPClient` interface, `InMemoryMCPClient` stub, server lifecycle |

### 2.7 Special Systems
| File | Role |
|------|------|
| `snapshots.ts` (6KB) | `SnapshotManager`: `git write-tree` / `git read-tree` per step, diff helpers via API routes |
| `evals.ts` (9KB) | Evaluation framework: automated agent test suite runner |
| `preflight.ts` (2KB) | Pre-execution validation: model compatibility, mode checks |
| `runtime-loop-guard.ts` (1KB) | Cyclic tool pattern detection to break infinite tool loops |
| `oracle.ts` (3KB) | Knowledge distillation: context synthesis for compaction |
| `identifier.ts` (1KB) | Ordered unique ID generation for messages and parts |
| `runtime-summary.ts` (2KB) | Post-run summary generation |

### 2.8 Spec System (`lib/agent/spec/`)
| File | Role |
|------|------|
| `engine.ts` | `SpecEngine`: orchestrates classify → generate → validate → verify lifecycle |
| `classifier.ts` | Heuristic + LLM-based intent classification → `SpecTier` |
| `types.ts` (325 lines) | All spec types: `FormalSpecification`, `SpecTier`, `SpecStatus`, `AcceptanceCriterion`, `SpecStep`, `Invariant` |
| `verifier.ts` | Post-execution spec verification: acceptance criteria, constraint checking |
| `persistence.ts` (189 lines) | Maps specs to/from Convex mutation inputs |
| `drift-detection.ts` | File-level drift monitoring against active specs |

---

## 3. Core Execution Loop

### 3.1 Entry Points

The public API has two entry points, both returning `AsyncGenerator<RuntimeEvent>`:

```typescript
// Start a new session
runtime.run(sessionID: string, userMessage: string, initialMessages?: Message[])

// Resume from a saved checkpoint
runtime.resume(sessionID: string)
```

Callers iterate this generator to receive events in real time. The generator pattern provides natural backpressure — the harness pauses producing until the consumer reads the next value.

### 3.2 The Step Loop (`runtime.ts` lines 688–861)

```
while (!isComplete && step < maxSteps):
  1. Emit: step_start
  2. Run: plugin hooks (step.start)
  3. Process: any pending subtask completions
  4. Check: context compaction needed?
  5. Execute: single LLM step → executeStep()
  6. Capture: git snapshot (if enabled)
  7. Evaluate: finishReason → completion, error, or continue
  8. Persist: checkpoint to CheckpointStore
  9. Emit: step_finish
  10. Check: build-mode narration failures

After loop exits:
  if (!isComplete): emit error('step-budget-exhausted')
  else: emit complete with run summary
```

**Max-steps enforcement:** `maxSteps` defaults to 50 (configurable per agent). On the last step, `isLastStep = true` forces text-only output (no tool calls allowed). If the loop exits without completion, a `step-budget-exhausted` terminal error event is emitted.

**Cancellation:** Every async operation checks `AbortController.signal`, enabling clean mid-step cancellation.

### 3.3 Single Step Execution (`executeStep`)

Within each step:
1. Build `CompletionMessage[]` from message history + system prompt + tool schemas
2. Stream LLM response via `provider.completionStream()`
3. Collect text, reasoning, and tool calls from stream chunks
4. On stream end: schedule tool calls via `tool-scheduling.ts` (parallel or sequential)
5. Dispatch each tool call through the full permission + execution pipeline
6. Append assistant message with all parts (text, reasoning, tool results) to state
7. Check `finishReason` for terminal condition

### 3.4 Terminal States

| State | Trigger |
|-------|---------|
| `complete` | LLM returns `finishReason: 'stop'` and no pending tools |
| `error` | Compaction failed twice; grammar leak detected; tool loop threshold hit |
| `step-budget-exhausted` | Loop exited without completion |
| Cancelled | `AbortController.abort()` called by consumer |

---

## 4. Tool System

### 4.1 Tool Definition Contract

```typescript
type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
) => Promise<{ output: string; error?: string; metadata?: Record<string, unknown> }>

interface ToolExecutionContext {
  sessionID: string
  messageID: string
  agent: AgentConfig
  abortSignal: AbortSignal
  metadata: (data: Record<string, unknown>) => void  // async side-channel
  ask: (question: string) => Promise<string>          // blocking Q&A escalation
}
```

Tool executors are plain async functions registered as a `Map<string, ToolExecutor>`. There is no class system or decorator magic — this makes extraction trivial.

### 4.2 Built-in Tool Set

Defined in `lib/agent/tools/` (imported by harness, not the harness itself):

| Tool | Permission Tier | Description |
|------|----------------|-------------|
| `read_files` | read | Read file contents by path |
| `write_files` | edit (high-risk) | Write/overwrite files |
| `list_directory` | read | Directory listing |
| `run_command` | exec (critical-risk) | Execute shell commands |
| `search_codebase` | search | Semantic codebase search |
| `search_code` | search | Regex/text pattern search |
| `search_code_ast` | search | AST-aware code search |
| `update_memory_bank` | memory | Persist agent memory |
| `task` | exec | Subagent delegation |
| `question` | — | Human escalation (ask agent only) |

### 4.3 Full Tool Dispatch Pipeline

When the LLM returns a tool call, it passes through 13 stages before execution:

1. **JSON Parse & Argument Extraction** — Repair malformed JSON via `tool-repair.ts`
2. **Pattern Extraction** — Extract file paths and command strings for permission targeting
3. **Capability-Based Guard** — New permission rule evaluation (deny blocks here)
4. **Risk-Tier Classification** — Classify into `low | medium | high | critical`
5. **Risk Policy Decision** — Apply `toolRiskPolicy` (eval mode overrides)
6. **Interrupt Request** — If `ask`, call `onToolInterrupt` callback
7. **Session Permissions Check** — Session-scoped automation overrides
8. **Spec Scope Validation** — Reject writes to files outside active spec scope
9. **Task Tool Special Casing** — Defer subagent execution for parallel scheduling
10. **Executor Lookup** — Find handler in `toolExecutors` Map
11. **Idempotency Cache Check** — Return cached result for identical read-tool calls
12. **Execution with Retry** — Run with 5-minute timeout, configurable retry + backoff
13. **Post-Execution Hooks** — `tool.execute.after` plugin hooks, drift check

The result is wrapped into a `ToolPart` appended to the current assistant message.

### 4.4 Tool Scheduling

The `tool-scheduling.ts` module analyzes a batch of tool calls and determines:
- Which tools can run in **parallel** (read-only tools, independent writes)
- Which must run **sequentially** (conflicting writes, commands that depend on file state)
- Deduplication of identical tool+args combinations within a step
- Enforcement of `maxToolCallsPerStep` (default 10)

---

## 5. LLM Provider Abstraction

### 5.1 Provider Interface

```typescript
interface LLMProvider {
  name: string   // 'anthropic' | 'openai' | 'google' | etc.
  config: {
    auth: { baseUrl?: string }
    defaultModel: string
  }
  completionStream(options: CompletionOptions): AsyncIterable<StreamChunk>
}
```

The harness is fully provider-agnostic. The provider is injected at construction time — the harness never imports an SDK directly.

### 5.2 Stream Chunk Contract

```typescript
interface StreamChunk {
  type: 'text' | 'tool_call' | 'reasoning' | 'finish' | 'error' | 'status_thinking'
  content?: string
  toolCall?: { name: string; id: string; arguments: string }
  reasoningContent?: string
  finishReason?: 'stop' | 'length' | 'tool-calls' | 'error' | 'content-filter'
  usage?: {
    promptTokens: number
    completionTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  error?: string
}
```

### 5.3 Stream Resilience

The harness wraps every provider stream call in `withTimeoutAndRetry()`:
- **Idle timeout:** 120 seconds of no chunks → abort + retry
- **Max retries:** 3 attempts with exponential backoff (default 2s base)
- **Context overflow:** If the provider returns an overflow error, compaction fires mid-stream and the step retries with a compacted message history

### 5.4 Grammar Leak Detection

Some LLMs occasionally emit tool calls as raw text instead of structured calls (especially at low temperatures or under long contexts). The harness detects this via `stream-sanitizer.ts` and grammar-specific extractors (`tool-call-grammars/`). A leak terminates the run with a `tool-call-leak-detected` error, preventing silent tool execution from text-formatted calls.

---

## 6. Permission Architecture

The harness has a two-generation permission model that coexists during a migration from the legacy to the capability-based system.

### 6.1 Legacy Permission Model (`permissions.ts`)

Tool-level permissions defined as `Record<string, 'allow' | 'deny' | 'ask'>`:

- Keys are tool names optionally with glob patterns: `write_files:src/*`
- Lookup: most-specific match wins (longer glob before shorter)
- Decision: `allow` proceeds, `deny` blocks with error result, `ask` fires an interrupt

**PermissionManager** manages runtime decisions:
- Maintains a session-scoped override map: `sessionID:tool:pattern → decision`
- Maintains a user cache map for repeated prompts in the same session
- `request(sessionID, tool, pattern)` → Promise<'allow' | 'deny'>: emits `permission_request` event on bus, waits for `respond()` call or timeout (60s → auto-deny)
- All decisions logged via `onAuditLog` callback

**Default permissions by agent mode:**
- **build:** all tools allow, except `question: deny`
- **plan:** read/search/memory allow, `write_files: deny`, `run_command: ask`
- **ask:** read/search allow, write/exec/task deny

### 6.2 Capability-Based Permission Model (`permission/`)

A more expressive rule system layered on top of the legacy model:

```typescript
type Capability = 'read' | 'search' | 'edit' | 'exec' | 'plan_exit' | 'memory' | 'mcp'

interface PermissionRule {
  capability: Capability | '*'
  pattern?: string        // file glob for edit, command prefix for exec
  decision: 'allow' | 'ask' | 'deny'
  reason?: string
  source: 'mode' | 'spec' | 'user' | 'project' | 'session'
}
```

**Evaluation:** Last-rule-wins semantics. Rules are filtered by capability and pattern, then the last matching rule's decision is applied.

**Subagent narrowing:** When a `task` tool spawns a subagent, `narrowRulesForSubagent()` filters the parent's rules through the subagent's `maxCapabilities` ceiling, then appends explicit deny rules for any capabilities not included. This ensures subagents can never exceed parent permissions.

### 6.3 Risk Interrupts

Independent of the permission system, the harness classifies each tool call into a risk tier (`low | medium | high | critical`) and applies `toolRiskPolicy`. At `high` (write_files) and `critical` (run_command), the default policy is to call `onToolInterrupt()` — a callback provided at construction time. The `PermissionDialog` in the React UI is the default handler for this callback.

For a CLI, this callback would write to stderr and prompt the user via stdin.

---

## 7. Plugin System

### 7.1 Plugin Interface

```typescript
interface Plugin {
  name: string
  priority?: number
  hooks?: {
    'tool.execute.before'?: (ctx: ToolHookContext) => Promise<void>
    'tool.execute.after'?: (ctx: ToolHookContext & { result: ToolResult }) => Promise<void>
    'session.start'?: (ctx: SessionHookContext) => Promise<void>
    'session.end'?: (ctx: SessionHookContext) => Promise<void>
    'llm.response'?: (ctx: LLMResponseHookContext) => Promise<void>
    'spec.execute.before'?: (ctx: SpecHookContext) => Promise<void>
    'spec.verify'?: (ctx: SpecVerifyHookContext) => Promise<void>
    'spec.drift.detected'?: (ctx: DriftHookContext) => Promise<void>
  }
  tools?: Record<string, ToolExecutor>       // Register additional tools
  agents?: Record<string, AgentConfig>       // Register additional agent types
}
```

Hooks execute sequentially in priority order. Plugin errors are caught and logged without halting the run.

### 7.2 Default Plugins (registered in `registerDefaultPlugins()`)

| Plugin | Purpose |
|--------|---------|
| `loggingPlugin` | Tool execution + session lifecycle logging, gated by `PANDA_AGENT_HARNESS_DEBUG_LOGS` |
| `costTrackingPlugin` | Calculates USD cost from token usage + hardcoded pricing tables |
| `specTrackingPlugin` | Logs spec lifecycle events, criterion pass/fail counts, drift warnings |
| `driftDetectionPlugin` | File-level write monitoring against active spec scope |

### 7.3 Custom Plugin Registration

Plugins can be registered before calling `run()`:

```typescript
pluginManager.register({
  name: 'my-cli-plugin',
  hooks: {
    'tool.execute.before': async (ctx) => { /* log to file */ },
    'tool.execute.after': async (ctx) => { /* emit progress to TUI */ }
  },
  tools: {
    'open_browser': async (args, ctx) => ({ output: 'opened' })
  }
})
```

The plugin system is the primary extension point for CLI-specific behavior (e.g., replacing the browser-rendered permission dialog with a terminal prompt).

---

## 8. Spec-Native System

The SpecNative system is Panda's declarative task specification layer that sits above the execution harness. Its purpose is to enforce intent clarity, scope control, and post-execution verification.

### 8.1 Spec Tiers

| Tier | When | User Interaction |
|------|------|-----------------|
| `instant` | Simple Q&A, read-only, trivial edits | No spec generated |
| `ambient` | Multi-file edits, medium complexity | Spec generated silently; shown on drift |
| `explicit` | New systems, migrations, auth changes | Spec surfaced for user approval before execution |

### 8.2 Spec Lifecycle

```
User message
    ↓
classify() → SpecTier (heuristic + optional LLM, confidence ≥ 0.9)
    ↓
generate() → FormalSpecification (goal, constraints, acceptance criteria, plan steps)
    ↓
[explicit tier only] → spec_pending_approval event → user must approve
    ↓
execute() → agent runs with activeSpec in system prompt
    ↓
verify() → post-execution acceptance criteria check (keyword + optional LLM judge)
    ↓
spec_verification event → UI/CLI shows pass/fail per criterion
```

### 8.3 FormalSpecification Type

```typescript
interface FormalSpecification {
  id: string
  version: number
  tier: SpecTier
  status: SpecStatus  // draft → validated → approved → executing → verified/drifted/failed/archived
  intent: {
    goal: string
    rawMessage: string
    constraints: Constraint[]           // structural/behavioral/performance/compatibility/security
    acceptanceCriteria: AcceptanceCriterion[]  // EARS-style: "WHEN X THE SYSTEM SHALL Y"
  }
  plan: {
    steps: SpecStep[]                   // Each step has description, tools[], targetFiles[], status
    dependencies: string[]
    risks: string[]
    estimatedTools: string[]
  }
  validation: {
    preConditions: string[]
    postConditions: string[]
    invariants: Invariant[]             // scope (file glob) + rule (what must stay true)
  }
  provenance: { model, promptHash, timestamp, parentSpecId?, chatId?, runId? }
  verificationResults?: VerificationResult[]
}
```

### 8.4 Drift Detection

After every tool execution that modifies files, the `driftDetectionPlugin` checks whether the modified file is within the active spec's scope:
- **In scope:** normal operation
- **Out of scope:** `drift_detected` event emitted; drift status recorded on spec

Scope is determined by matching the file path against `plan.steps[].targetFiles` and `validation.invariants[].scope` using glob patterns.

### 8.5 Current Implementation Status

| Component | Status |
|-----------|--------|
| Heuristic classifier | Production-ready |
| LLM classifier | Real, gated by `PANDA_SPEC_LLM_CLASSIFIER` env flag |
| Spec generator | Production-ready (template-based + LLM) |
| Verifier (keyword) | Production-ready |
| LLM judge verifier | Real, gated by `PANDA_SPEC_LLM_VERIFIER` env flag |
| Drift detection | Production-ready |
| Convex persistence | Production-ready |
| Active spec registration | Known gap — `registerActiveSpec()` not called when spec goes active |

---

## 9. Context & Session Management

### 9.1 Conversation History

Runtime state maintains `messages: Message[]` — the full conversation thread. Each message is either a `UserMessage` or `AssistantMessage` containing structured `parts`:

- `TextPart` — narrative output
- `ReasoningPart` — Claude extended thinking scratch pad
- `ToolPart` — tool call record with state machine (`pending → running → completed | error`)
- `SubtaskPart` — deferred subagent result
- `StepStartPart / StepFinishPart` — step boundary markers with usage/cost metadata
- `CompactionPart` — context summarization marker
- `SnapshotPart / PatchPart` — git state markers
- `PermissionPart` — permission decision audit record

### 9.2 Context Compaction

Triggered at 90% of the context window (default 200k tokens for Anthropic, 128k for others):

1. Identify oldest N messages to compress (preserve most recent 4)
2. Truncate tool outputs to 10k characters each
3. Call LLM to summarize the old messages into a `CompactionPart`
4. Replace old messages with the summary
5. Continue execution
6. On two consecutive compaction failures: emit fatal error

Token estimation uses `js-tiktoken` with GPT-4o encoding in production, with a 4-chars-per-token heuristic in tests.

### 9.3 Checkpoint System

The `CheckpointStore` interface has two implementations:

| Store | Use case |
|-------|---------|
| `InMemoryCheckpointStore` | Development, testing, CLI (no persistence across process restarts) |
| `ConvexCheckpointStore` | Production web app (persists to Convex DB) |

`RuntimeCheckpoint` captures the full runtime state:
- All messages (with parts)
- Current step counter
- Pending subtasks (with start timestamps)
- Token usage counters (input/output/reasoning/cache)
- Tool loop tracking state (signatures, streaks, frequency maps)
- Compaction failure counters
- Active spec (FormalSpecification)

Checkpoints are saved after every step, after compaction, and on completion or error. The message dirty-flag optimization (`checkpointMessageSnapshot` + `messagesDirtySinceCheckpoint`) avoids re-cloning unchanged messages on every save.

For a CLI, `InMemoryCheckpointStore` is sufficient for a single session; a `FileCheckpointStore` (JSONL) would enable resumption across process restarts.

---

## 10. Snapshot System

`SnapshotManager` creates git tree objects per step without creating commits:

```
git add -A && git write-tree → tree hash
```

This captures the complete working-tree state atomically. To restore any snapshot:

```
git read-tree <hash> && git checkout-index -a -f
```

Snapshots are stored in memory (Map of sessionID → Snapshot[]). Diff and patch generation are currently routed through HTTP API routes (`/api/git/diff`, `/api/git/patch`). In a CLI, these would be replaced with direct `git diff <hash1> <hash2>` subprocess calls.

The snapshot system enables per-step undo without polluting git history.

---

## 11. Event Bus

The `EventBus` provides pub/sub for UI synchronization and plugin coordination:

- History of last 1000 events, with auto-replay for late subscribers
- Typed events: `session.*`, `message.*`, `part.*`, `tool.*`, `compaction.*`, `permission.*`, `error`
- Filtering by session ID, event type, or custom predicate

In the web app, `PermissionDialog` subscribes to `permission.requested` events. In a CLI, a terminal prompt subscriber would replace this.

---

## 12. MCP Integration

`mcp.ts` defines the `MCPClient` interface for connecting to MCP servers:

```typescript
interface MCPClient {
  serverID: string
  isConnected: boolean
  listTools(): Promise<MCPToolDefinition[]>
  listResources(): Promise<MCPResource[]>
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult>
  readResource(uri: string): Promise<MCPResourceContent>
  close(): Promise<void>
}
```

MCP server configurations support four transports: `inmemory`, `stdio`, `sse`, `http`. The `InMemoryMCPClient` stub is used in tests. A production implementation would use the `@modelcontextprotocol/sdk` client.

MCP tools are registered as `MCPToolDefinition` (extends `ToolDefinition`) with additional metadata identifying the originating server. They appear in the harness tool registry alongside built-in tools, completely transparent to the LLM.

---

# Part II — Pi.dev Platform Overview

## 1. What Is Pi.dev?

Pi is a minimal, extensible, TypeScript-native agent framework and CLI builder created by Mario Zechner (badlogic). It powers OpenClaw (Armin Ronacher's personal assistant platform) and has 44k+ GitHub stars on `badlogic/pi-mono`.

**Core philosophy:** Ship only what you need. Minimal core, maximum extensibility, no framework bloat.

**Target audience:** TypeScript developers who want a lightweight foundation for coding agents without the complexity of LangChain, LangGraph, or CrewAI.

---

## 2. Core Packages

| Package | Role |
|---------|------|
| `pi-ai` | Unified multi-provider LLM API (Anthropic, OpenAI, Google, Bedrock, Groq, Cerebras, xAI, OpenRouter, Mistral, GitHub Copilot, Ollama) |
| `pi-agent-core` | Wraps `pi-ai` into an agent loop with tool calling, parallel execution, event streaming, steering queue, follow-up queue |
| `pi-coding-agent` | Full runtime: file tools, session persistence (JSONL tree), context compaction, skills system, extension architecture |
| `pi-tui` | Terminal UI: differential rendering, markdown display, autocomplete, loading spinners |
| `pi-mcp-adapter` | MCP server integration with context optimization (lazy connection, single proxy tool default) |

---

## 3. Execution Model

Pi's agent loop: `send messages → execute tool calls concurrently → feed results back → repeat until stop`

**Key characteristics:**
- **Local execution:** Runs on the user's machine; commands execute with the user's full shell permissions
- **Cloud LLMs:** API calls go to cloud providers; no sandboxing by default
- **Session format:** JSONL tree structure enabling branching and non-linear history
- **Context compaction:** Auto-compaction triggered when approaching context window limits
- **Steering queue:** Messages that interrupt the current operation
- **Follow-up queue:** Messages that wait for idle agent

**Output modes:**
- Interactive TUI (default)
- Headless/print (`-p "query" --mode json`) for scripting
- RPC mode (`--mode rpc`): JSON-over-stdio for embedding in Python/Ruby/Go/etc.
- SDK mode: import `pi-agent-core` into Node/TypeScript apps

---

## 4. Extension System

Extensions are TypeScript modules loaded via `jiti` (no compilation, hot-reload):

```typescript
// ~/.pi/agent/extensions/my-tool.ts
export default {
  tools: {
    my_tool: async (args) => ({ output: 'result' })
  },
  agents: { ... },
  prompts: { ... }
}
```

Extensions can add: tools, UI widgets, custom LLM providers, compaction strategies, command handlers.

Skills are capability packages with instructions and tools, loaded on-demand without breaking prompt cache.

---

## 5. MCP Support

`pi-mcp-adapter` provides native MCP integration with context optimization:
- **Default mode:** All MCP tools accessed through a single proxy tool (minimal context usage, tools discovered on-demand)
- **Direct mode:** Specific MCP tools listed directly in agent's tool schema
- **Lazy lifecycle:** Connects on first use, disconnects after idle timeout
- **Metadata caching:** Tool metadata cached locally for discovery without active connections

---

## 6. Distribution

- Published to npm: `@mariozechner/pi-coding-agent`, `@oh-my-pi/pi-coding-agent`
- Extensions as npm or git packages: `pi install npm:@foo/pi-tools`
- Extensions install to `~/.pi/agent/git/` or global npm

---

# Part III — Integration Strategy: Panda Harness + Pi.dev CLI

## 1. Alignment Analysis

The Panda Harness and Pi.dev share a remarkably similar architecture. This makes the integration natural rather than forced:

| Concept | Panda Harness | Pi.dev Equivalent |
|---------|--------------|-------------------|
| Agent loop | `runtime.ts` step loop, `AsyncGenerator<RuntimeEvent>` | `pi-agent-core` agent loop with event streaming |
| LLM provider | `LLMProvider` interface (`completionStream`) | `pi-ai` unified multi-provider API |
| Tool executor | `ToolExecutor`: `(args, ctx) => Promise<{output}>` | Pi tool: `(args) => Promise<{output}>` |
| Plugin system | `PluginManager` with lifecycle hooks | Pi extension system |
| Context compaction | `compaction.ts` at 90% threshold | `pi-coding-agent` auto-compaction |
| Session persistence | `CheckpointStore` (InMemory / Convex) | Pi JSONL session files |
| MCP integration | `mcp.ts` MCPClient interface | `pi-mcp-adapter` |
| Terminal UI | React components (web only) | `pi-tui` |
| Permission interrupt | `PermissionManager` event-bus | CLI stdin prompt |
| Streaming events | `RuntimeEvent` generator | Pi event streaming |

**Key insight:** The Panda Harness's `LLMProvider` interface and `ToolExecutor` contract are narrow and clean. Pi's `pi-ai` package can be wrapped to satisfy `LLMProvider`. The tool registry is a plain `Map<string, ToolExecutor>` — Pi extensions can populate it.

---

## 2. Two Integration Approaches

### Option A: Pi.dev as Shell, Panda Harness as Engine (Recommended)

Use Pi's CLI infrastructure (TUI, extension loading, session management, MCP adapter) as the outer shell while running the Panda Harness as the inner execution engine.

**What Pi provides:**
- Terminal UI (`pi-tui`): markdown rendering, spinners, autocomplete
- Extension loading: hot-reload TypeScript extensions
- Session persistence: JSONL tree files
- MCP integration: `pi-mcp-adapter` for connecting MCP servers
- CLI argument parsing and output modes (interactive, print, RPC)
- npm packaging and distribution

**What the Panda Harness provides:**
- The execution engine: step loop, tool dispatch pipeline, permission enforcement
- Permission model: capability-based rules, risk interrupts, session overrides
- Spec-native system: classify → generate → verify
- Snapshot system: per-step git undo
- Compaction: LLM-based context summarization
- Subagent delegation: `task` tool with 21 agent types
- Tool loop detection, tool repair, stream sanitization

**Adapter layer required:**
- Wrap `pi-ai`'s provider as a Panda `LLMProvider`
- Replace `onToolInterrupt` callback with a `pi-tui` approval prompt
- Replace `ConvexCheckpointStore` with `InMemoryCheckpointStore` or `FileCheckpointStore`
- Replace snapshot API routes with direct git subprocess calls
- Wire Pi extensions → Panda plugin system

### Option B: Panda Harness as a Pi Extension

Package the harness as a Pi extension that replaces Pi's default agent loop entirely. This is more invasive but enables full Panda semantics within the Pi ecosystem.

**When to use Option B:** If you want the CLI to be installable via `pi install npm:@panda/pi-harness` by existing Pi users.

---

## 3. Critical Extraction Points

The harness has these web/Convex dependencies that must be replaced for a pure CLI:

| Dependency | Current | CLI Replacement |
|-----------|---------|----------------|
| `ConvexCheckpointStore` | Persists to Convex DB | `FileCheckpointStore` (JSONL at `~/.panda/sessions/`) |
| `PermissionDialog` (React) | Browser modal for approvals | `onToolInterrupt` callback → `readline`/`pi-tui` prompt |
| `/api/git/diff` API route | HTTP API for snapshot diffs | Direct `git diff <hash1> <hash2>` subprocess |
| `NEXT_PUBLIC_*` env flags | Next.js env prefix | Standard `PANDA_*` env vars |
| `js-tiktoken` (WASM) | Token counting | Same package (works in Node.js) |
| Convex ID types | `@convex/_generated/dataModel` | Strip or replace with string IDs |
| Event bus (React sync) | Browser pub/sub | Node.js `EventEmitter` or async iterators |

The harness core (`runtime.ts`, `types.ts`, tool dispatch pipeline, permission system, spec system, compaction, snapshots) has **zero React or Next.js imports**. The extraction boundary is clean.

---

## 4. Implementation Phases

### Phase 1 — Harness Package Extraction
- Create `packages/harness/` monorepo package
- Copy `lib/agent/harness/` and `lib/agent/spec/` with zero changes
- Create `packages/harness/src/stores/file-checkpoint-store.ts` (JSONL-based)
- Strip Convex ID types: replace `Id<'specifications'>` with `string`
- Replace `NEXT_PUBLIC_` prefix with `PANDA_` in all env var reads
- Replace `/api/git/diff` HTTP call with `execa('git', ['diff', hash1, hash2])`
- Run: `bun test packages/harness/` — all existing tests should pass unchanged

### Phase 2 — Pi.dev Shell Integration
- Create `packages/panda-cli/` with `pi-agent-core` + `pi-tui` + `pi-mcp-adapter` as dependencies
- Implement `PandaLLMProvider` adapter: wraps `pi-ai`'s `completionStream` to match `LLMProvider` interface
- Implement `onToolInterrupt` handler: renders a `pi-tui` confirmation prompt for `high`/`critical` tools
- Build Pi extension: `export default { tools: AGENT_TOOLS, plugins: [...] }`
- Wire MCP servers from Pi's extension config into harness's `mcp.ts` client registry

### Phase 3 — CLI Commands
```
panda run "build a REST API for user auth"     # one-shot agentic run
panda chat                                      # interactive session
panda resume <sessionID>                        # resume from checkpoint
panda sessions                                  # list saved sessions
panda snapshot restore <hash>                   # git undo to step
panda spec show <specID>                        # display spec
```

### Phase 4 — Spec-Native CLI UX
- `spec_pending_approval` event → render spec in `pi-tui` with inline approval (`y/n`)
- `spec_verification` event → render pass/fail criteria table
- `drift_detected` event → render warning banner with affected files
- Wire `registerActiveSpec()` when spec status transitions to `executing`

### Phase 5 — Distribution
- Publish `@panda/cli` to npm
- Extension registry: `pi install npm:@panda/cli`
- Homebrew formula for direct install

---

## 5. Key Files to Modify/Create

| Action | File |
|--------|------|
| Create | `packages/harness/src/stores/file-checkpoint-store.ts` |
| Create | `packages/panda-cli/src/providers/pi-ai-adapter.ts` |
| Create | `packages/panda-cli/src/interrupt/terminal-interrupt.ts` |
| Create | `packages/panda-cli/src/cli.ts` (main entry point) |
| Modify | `packages/harness/src/snapshots.ts` (replace API routes with git subprocess) |
| Modify | `packages/harness/src/harness/convex-checkpoint-store.ts` (extract interface only) |
| No change | `runtime.ts`, `types.ts`, `permissions.ts`, `plugins.ts`, `compaction.ts`, `spec/` |

The core harness files require **zero modification** for extraction.

---

## 6. Verification

After each phase, run:

```bash
# Phase 1 — harness tests pass without Convex or Next.js
bun test packages/harness/

# Phase 2 — CLI boots and produces streaming output
node packages/panda-cli/dist/cli.js run "list files in this directory"

# Phase 3 — Full tool dispatch pipeline works
node packages/panda-cli/dist/cli.js run "create a hello.ts file that prints hello world" --agent build

# Phase 4 — Spec system works end-to-end
PANDA_SPEC_LLM_CLASSIFIER=1 node packages/panda-cli/dist/cli.js run "build a REST API for user registration"
# Expect: spec_pending_approval event → prompt → execution → spec_verification event

# Phase 5 — MCP integration works
node packages/panda-cli/dist/cli.js run "search the web for Pi.dev docs" --mcp pi-mcp-adapter
```

---

## 7. Open Questions for Decision

1. **Option A vs. Option B?** Do you want Pi as the outer shell (A, recommended) or the harness as a Pi extension (B)?
2. **Spec-Native in CLI?** The spec system adds significant UX surface area. Should it be opt-in (`--spec`) or always-on (matching web behavior)?
3. **Snapshot system?** The git snapshot per-step is valuable for undo but requires the CLI to run inside a git repo. Should it be optional?
4. **FileCheckpointStore format?** JSONL (append-only, resumable) vs. SQLite (queryable sessions list)?
5. **Auth model?** The web app uses Clerk. The CLI could use API key env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) directly via `pi-ai`.
