/**
 * Resonanco — Core Engine
 *
 * Parses delegation instructions (MODE + STEPS) directly from the prompt
 * and dispatches sub-agents. No internal Manager LLM — the main agent
 * (pi assistant) is the Manager.
 *
 * Three dispatch modes:
 *   one-to-one: delegate to a single sub-agent
 *   chain:      multiple sub-agents relay sequentially ({previous} for prior output)
 *   full-graph: all agents run in parallel
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AgentRole,
  AgentCallRecord,
  DispatchMode,
  PermissionLevel,
  ResonancoConfig,
  WorkPhase,
} from "../types/index.ts";
import {
  DEFAULT_CONFIG, ALL_PHASES, SUB_AGENT_ROLES,
  ROLE_DISPLAY_NAMES, DISPATCH_MODE_LABELS,
} from "../types/index.ts";
import { ContextPool } from "../context/pool.ts";
import { PermissionGuard } from "./permissions.ts";
import { runSingleAgent, getFinalOutput, isFailedResult } from "./runner.ts";
import { discoverAgents } from "../agents/registry.ts";

export interface EngineOptions {
  config?: Partial<ResonancoConfig>;
}

export interface EngineStatus {
  phase: WorkPhase;
  currentAgent: AgentRole | null;
  stepCount: number;
  agentHistory: AgentCallRecord[];
  contextStats: { total: number; byRole: Record<string, number> };
  permissionLevel: PermissionLevel;
  dispatchMode: DispatchMode | null;
  running: boolean;
  lastOutputs: Record<string, string>;
  activeAgents: string[];
}

const MAX_STEPS = 50;

export class ResonancoEngine {
  public config: ResonancoConfig;
  public pool: ContextPool;
  public permission: PermissionGuard;

  private stepCount = 0;
  private currentPhase: WorkPhase = "reception";
  private currentAgent: AgentRole | null = null;
  private agentHistory: AgentCallRecord[] = [];
  private startTime = 0;
  private dispatchMode: DispatchMode | null = null;
  private _running = false;
  private _lastOutputs: Record<string, string> = {};
  private _onAgentOutput: ((agent: string, output: string, reasoning?: string) => void) | null = null;
  private _activeAgents: Set<string> = new Set();
  private _customAgentNames: string[] = [];

  setCustomAgents(names: string[]) {
    this._customAgentNames = names;
  }

  constructor(options?: EngineOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.pool = new ContextPool(this.config.contextDecayFactor, this.config.contextWeightCap);
    this.permission = new PermissionGuard(this.config.defaultPermissionLevel);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Public API
  // ══════════════════════════════════════════════════════════════════

  async run(
    userPrompt: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    onAgentOutput?: ((agent: string, output: string, reasoning?: string) => void) | undefined,
  ): Promise<{
    content: { type: "text"; text: string }[];
    details: any;
    isError?: boolean;
  }> {

    this._onAgentOutput = onAgentOutput ?? null;
    this.reset();
    this.startTime = Date.now();
    this._running = true;
    this._activeAgents = new Set();

    if (signal?.aborted) return this.abort("User aborted");

    // Parse delegation instructions directly from the prompt — no internal Manager LLM.
    // The main agent (pi assistant) is the Manager and specifies agent/task assignments.
    const decision = this.parseManagerDecision(userPrompt);

    if (decision.action === "error" || !decision.mode || !decision.steps || decision.steps.length === 0) {
      this._running = false;
      return {
        content: [{ type: "text", text: [
          `Could not parse delegation instructions.`,
          ``,
          `Expected format in the prompt:`,
          `  MODE: one-to-one | chain | full-graph`,
          `  STEPS:`,
          `    1. <agent>: <task description>`,
          `    2. <agent>: <task description>`,
          `  Available agents: ${SUB_AGENT_ROLES.join(", ")}${this._customAgentNames.length > 0 ? ", " + this._customAgentNames.join(", ") : ""}`,
          ``,
          `Parse error: ${decision.message ?? "no steps found"}`,
        ].join("\n") }],
        details: this.getDetails(), isError: true,
      };
    }

    this.dispatchMode = decision.mode;

    // Permission check
    if (this.permission.checkOperation("manager" as AgentRole, "relay_decision").requiresConfirm) {
      this._running = false;
      const stepDesc = decision.steps.map((s, i) =>
        `  ${i + 1}. ${ROLE_DISPLAY_NAMES[s.agent]}: ${s.task.slice(0, 120)}`).join("\n");
      return {
        content: [{ type: "text", text: `Plan: **${DISPATCH_MODE_LABELS[decision.mode]}**\n${stepDesc}\n\nApprove?` }],
        details: this.getDetails(),
      };
    }

    // Execute dispatch directly — no Manager LLM loop
    const contextSummary = this.pool.generateSummary();
    const result = await this.executeDispatch(
      decision.mode, decision.steps,
      decision.context ?? contextSummary,
      ctx, signal, onUpdate,
    );

    this.stepCount++;

    if (result.failed) {
      this._running = false;
      return {
        content: [{ type: "text", text: result.failed }],
        details: this.getDetails(), isError: true,
      };
    }

    this._running = false;
    return this.complete(userPrompt);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Dispatch Execution
  // ══════════════════════════════════════════════════════════════════

  private async executeDispatch(
    mode: DispatchMode,
    steps: Array<{ agent: AgentRole; task: string }>,
    contextSummary: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
  ): Promise<{ handoff?: boolean; failed?: string }> {
    // Deduplicate: at most one instance per agent type
    {
      const seen = new Set<string>();
      steps = steps.filter((s) => {
        if (seen.has(s.agent)) return false;
        seen.add(s.agent);
        return true;
      });
    }

    switch (mode) {
      case "one-to-one": return this.execOneToOne(steps, contextSummary, ctx, signal, onUpdate);
      case "chain":      return this.execChain(steps, contextSummary, ctx, signal, onUpdate);
      case "full-graph": return this.execFullGraph(steps, contextSummary, ctx, signal, onUpdate);
      default:
        return { failed: `Unknown dispatch mode: ${mode}` };
    }
  }

  /** one-to-one: delegate to a single sub-agent, Manager decides next */
  private async execOneToOne(
    steps: Array<{ agent: AgentRole; task: string }>,
    contextSummary: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
  ): Promise<{ handoff?: boolean; failed?: string }> {
    const step = steps[0];
    if (!step) return { failed: "one-to-one mode requires a sub-agent" };

    this.currentAgent = step.agent;
    const record = this.pushHistory(step.agent, step.task);

    if (onUpdate) {
      const stepNum = this.stepCount + 1;
      onUpdate({
        content: [{ type: "text", text: `[${stepNum}/${MAX_STEPS}] one-to-one -> ${ROLE_DISPLAY_NAMES[step.agent]} working...` }],
        details: this.getDetails(),
      });
    }

    const fullTask = `${contextSummary}\n\n━━━ Task ━━━\n\n${step.task}`;
    const result = await this.execSubAgent(step.agent, fullTask, ctx, signal, onUpdate);
    this.finishRecord(record, result);

    if (!isFailedResult(result)) {
      this.pool.add(step.agent, step.agent, this.currentPhase, getFinalOutput(result.messages) || "(no output)");
      this.pool.decay();
    }

    this.updatePhase(step.agent);
    return {};
  }

  /** chain: relay multiple sub-agents sequentially */
  private async execChain(
    steps: Array<{ agent: AgentRole; task: string }>,
    contextSummary: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
  ): Promise<{ handoff?: boolean; failed?: string }> {
    let previousOutput = contextSummary;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      this.currentAgent = step.agent;
      const record = this.pushHistory(step.agent, step.task);

      // replace {previous} with previous output
      const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
      const fullTask = `${previousOutput}\n\n--- Step ${i + 1} Task ---\n\n${taskWithContext}`;

      if (onUpdate) {
        onUpdate({
          content: [{
            type: "text",
            text: `[chain ${i + 1}/${steps.length}] -> ${ROLE_DISPLAY_NAMES[step.agent]} working...`,
          }],
          details: this.getDetails(),
        });
      }

      const result = await this.execSubAgent(step.agent, fullTask, ctx, signal, onUpdate);
      this.finishRecord(record, result);

      if (isFailedResult(result)) {
        return { failed: `Chain failed at step ${i + 1} (${step.agent}): ${result.stderr || "Unknown error"}` };
      }

      const output = getFinalOutput(result.messages) || "(no output)";
      this.pool.add(step.agent, step.agent, this.currentPhase, output);
      this.pool.decay();
      previousOutput = output;
      this.updatePhase(step.agent);
    }

    return {};
  }

  /** full-graph: fully connected graph, run all steps in parallel */
  private async execFullGraph(
    steps: Array<{ agent: AgentRole; task: string }>,
    contextSummary: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
  ): Promise<{ handoff?: boolean; failed?: string }> {
    if (onUpdate) {
      onUpdate({
        content: [{ type: "text", text: `[full-graph] Launching ${steps.length} nodes in parallel...` }],
        details: this.getDetails(),
      });
    }

    this.currentAgent = null;

    // Run all steps in parallel so multiple braille dots spin simultaneously
    const results = await Promise.all(steps.map(async (step) => {
      const record = this.pushHistory(step.agent, step.task);

      const previousContext = this.pool.generateSummary() || contextSummary;
      const fullTask = `You are in a parallel collaboration graph. Previous work:\n\n${previousContext}\n\n--- Your Task ---\n\n${step.task}\n\nOutput your result.\n`;

      const result = await this.execSubAgent(step.agent, fullTask, ctx, signal, onUpdate);
      this.finishRecord(record, result);

      if (isFailedResult(result)) {
        return { agent: step.agent, failed: true, error: result.stderr || "Unknown error" };
      }

      const output = getFinalOutput(result.messages) || "(no output)";
      this.pool.add(step.agent, step.agent, this.currentPhase, output);
      this.pool.decay();
      this.updatePhase(step.agent);
      return { agent: step.agent, failed: false };
    }));

    const failures = results.filter((r) => r.failed);
    if (failures.length > 0) {
      const msgs = failures.map((f) => `${f.agent}: ${f.error}`).join("; ");
      return { failed: `Parallel execution failures: ${msgs}` };
    }

    return {};
  }

  // ══════════════════════════════════════════════════════════════════
  //  Parse delegation from prompt (no internal Manager LLM)
  // ══════════════════════════════════════════════════════════════════

  private parseManagerDecision(output: string): {
    action: "assign" | "error";
    mode?: DispatchMode;
    steps?: Array<{ agent: AgentRole; task: string }>;
    context?: string;
    message?: string;
  } {
    const raw = output;
    const cleaned = raw.replace(/\*\*(.+?)\*\*/g, "$1");
    const lines = cleaned.split("\n").map((l) => l.trim());

    // Helper: find value after a key:
    const findVal = (...prefixes: string[]): string | undefined => {
      for (const prefix of prefixes) {
        for (const line of lines) {
          const m = line.match(new RegExp(`^\\s*${prefix}\\s*[:]\\s*(.+)$`, "i"));
          if (m) return m[1].trim();
        }
      }
      return undefined;
    };

    // Find MODE
    const modeRaw = (findVal("MODE") ?? "one-to-one").toLowerCase();
    let mode: DispatchMode = "one-to-one";
    if (modeRaw.includes("chain")) mode = "chain";
    else if (modeRaw.includes("graph") || modeRaw.includes("full")) mode = "full-graph";

    // Parse STEPS: look for numbered lines like "1. <agent>: <task>"
    // Supports multi-line task descriptions: subsequent lines are appended
    // to the current step's task until the next numbered step or a stop keyword.
    const steps: Array<{ agent: AgentRole; task: string }> = [];
    let inSteps = false;
    let currentStep: { agent: AgentRole; task: string } | null = null;

    for (const line of lines) {
      if (/^STEPS\s*[:]/i.test(line)) { inSteps = true; continue; }
      if (!inSteps) continue;
      if (/^(CONTEXT|REASON|ACTION|MODE)\s*[:]/i.test(line)) break;

      // Check if this is a new numbered step
      const stepMatch = line.match(/^[\d\-\.\*\)]+\s*\.?\s*([a-zA-Z]+)\s*[:]\s*(.*)$/);
      if (stepMatch) {
        const agentName = stepMatch[1].toLowerCase() as AgentRole;
        if (SUB_AGENT_ROLES.includes(agentName) || this._customAgentNames.includes(agentName)) {
          // Save previous step if exists
          if (currentStep) steps.push(currentStep);
          currentStep = { agent: agentName as any, task: stepMatch[2].trim() };
          continue;
        }
      }

      // If not a new step, append to current step's task (multi-line support)
      if (currentStep && line) {
        currentStep.task += "\n" + line;
      }
    }

    // Push the last accumulated step
    if (currentStep) steps.push(currentStep);

    if (steps.length === 0) {
      return { action: "error", message: `parseManagerDecision: no STEPS parsed\nRaw: ${raw.slice(0, 400)}` };
    }

    if (mode === "one-to-one" && steps.length > 1) {
      mode = "chain";
    }

    return { action: "assign", mode, steps, context: findVal("CONTEXT") };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Sub-Agent Execution
  // ══════════════════════════════════════════════════════════════════

  private async execSubAgent(
    agent: AgentRole,
    fullTask: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
  ): Promise<import("./runner.ts").SingleResult> {
    const agents = discoverAgents(ctx.cwd, "both").agents;
    const agentConfig = agents.find((a) => a.name === agent);

    if (!agentConfig) {
      return {
        agent, agentSource: "unknown", task: fullTask, exitCode: 1,
        messages: [], stderr: `Agent "${agent}" definition not found`,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
      } as any;
    }

    return runSingleAgent(
      ctx.cwd, [agentConfig], agent, fullTask,
      undefined, this.stepCount + 1, signal, onUpdate as any,
      (r) => ({ results: r }), this.config as any,
    );
  }

  // ══════════════════════════════════════════════════════════════════
  //  Record Keeping
  // ══════════════════════════════════════════════════════════════════

  private pushHistory(agent: AgentRole, task: string): AgentCallRecord {
    this._activeAgents.add(agent);
    const record: AgentCallRecord = {
      agent, task: task.slice(0, 200), startedAt: Date.now(), status: "running",
    };
    this.agentHistory.push(record);
    return record;
  }

  private finishRecord(record: AgentCallRecord, result: import("./runner.ts").SingleResult): void {
    this._activeAgents.delete(record.agent);
    record.status = isFailedResult(result) ? "failed" : "completed";
    record.completedAt = Date.now();
    record.output = getFinalOutput(result.messages);
    const reasoning = (result as any).reasoning as string | undefined;
    if (record.output) {
      this._lastOutputs[record.agent] = record.output;
      this._onAgentOutput?.(record.agent, record.output, reasoning);
    }
    if ((result as any).usage) record.usage = (result as any).usage;
  }

  private updatePhase(agent: AgentRole): void {
    const phaseMap: Record<string, WorkPhase> = {
      coder: "execution", reviewer: "quality", architect: "planning",
      tester: "quality", documenter: "quality", devops: "execution", researcher: "reconnaissance",
      delivery: "quality",
    };
    const suggested = phaseMap[agent] ?? "execution";
    const currentIdx = ALL_PHASES.indexOf(this.currentPhase);
    const suggestedIdx = ALL_PHASES.indexOf(suggested);
    if (suggestedIdx > currentIdx) this.currentPhase = suggested;
  }

  // ══════════════════════════════════════════════════════════════════
  //  Output Helpers
  // ══════════════════════════════════════════════════════════════════

  private complete(originalPrompt: string) {
    this._running = false;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const totalCost = this.agentHistory.reduce((s, h) => s + (h.usage?.cost ?? 0), 0);
    const totalTurns = this.agentHistory.reduce((s, h) => s + (h.usage?.turns ?? 0), 0);

    const historyStr = this.agentHistory
      .map((h, i) => `  ${i + 1}. **${h.agent}**: ${h.task.slice(0, 80)} ` + (h.status === "completed" ? "OK" : "FAIL"))
      .join("\n");

    return {
      content: [{
        type: "text",
        text: [
          `=== Resonanco Delivery Report ===`,
          ``,
          `**Request**: ${originalPrompt}`,
          `**Status**: Completed`,
          `**Execution Log**:`,
          historyStr,
          ``,
          `**Stats**:`,
          `  - Steps: ${this.stepCount}  |  Mode: ${this.dispatchMode ? DISPATCH_MODE_LABELS[this.dispatchMode] : "N/A"}`,
          `  - Agents: ${[...new Set(this.agentHistory.map((h) => h.agent))].join(", ")}`,
          `  - Duration: ${duration}s  |  Cost: $${totalCost.toFixed(4)}  |  Turns: ${totalTurns}`,
          `  - Context pool: ${this.pool.getStats().total} entries`,
        ].join("\n"),
      }],
      details: this.getDetails(true),
    };
  }

  private abort(reason: string) {
    this._running = false;
    return {
      content: [{ type: "text", text: `Resonanco aborted: ${reason}` }],
      details: this.getDetails(), isError: true,
    };
  }

  private getDetails(completed = false) {
    return {
      phase: this.currentPhase, currentAgent: this.currentAgent,
      stepCount: this.stepCount, dispatchMode: this.dispatchMode,
      agentHistory: this.agentHistory,
      contextPool: { total: this.pool.getStats().total, byRole: this.pool.getStats().byRole },
      permissionLevel: this.permission.getGlobalLevel(), completed, startedAt: this.startTime,
    };
  }

  reset(): void {
    this.stepCount = 0;
    this.currentPhase = "reception";
    this.currentAgent = null;
    this.agentHistory = [];
    this.dispatchMode = null;
    this.pool.reset();
  }

  getStatus(): EngineStatus {
    return {
      phase: this.currentPhase, currentAgent: this.currentAgent,
      stepCount: this.stepCount, dispatchMode: this.dispatchMode,
      agentHistory: [...this.agentHistory],
      contextStats: this.pool.getStats(),
      permissionLevel: this.permission.getGlobalLevel(),
      running: this._running,
      lastOutputs: { ...this._lastOutputs },
      activeAgents: [...this._activeAgents],
    };
  }
}
