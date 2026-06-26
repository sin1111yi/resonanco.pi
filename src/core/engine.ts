/**
 * Resonanco — Core Engine
 *
 * Manages multi-agent collaboration session lifecycle.
 *
 * Three dispatch modes:
 *   one-to-one: delegate to one sub-agent, Manager decides next
 *   chain:      multiple sub-agents relay sequentially
 *   full-graph: fully connected graph, Manager decides each step dynamically
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
import { RelayDecider } from "./relay.ts";
import { ObserverProtocol } from "../observer/protocol.ts";
import { runSingleAgent, getFinalOutput, isFailedResult, mapWithConcurrencyLimit } from "./runner.ts";
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
  public relay: RelayDecider;
  public observer: ObserverProtocol;

  private stepCount = 0;
  private currentPhase: WorkPhase = "reception";
  private currentAgent: AgentRole | null = null;
  private agentHistory: AgentCallRecord[] = [];
  private startTime = 0;
  private dispatchMode: DispatchMode | null = null;
  private _running = false;
  private _lastOutputs: Record<string, string> = {};
  private _onAgentOutput: ((agent: string, output: string) => void) | null = null;
  private _activeAgents: Set<string> = new Set();
  private _customAgentNames: string[] = [];

  setCustomAgents(names: string[]) {
    this._customAgentNames = names;
  }

  constructor(options?: EngineOptions) {
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
    this.pool = new ContextPool(this.config.contextDecayFactor, this.config.contextWeightCap);
    this.permission = new PermissionGuard(this.config.defaultPermissionLevel);
    this.relay = new RelayDecider(this.config);
    this.observer = new ObserverProtocol();
  }

  // ══════════════════════════════════════════════════════════════════
  //  Public API
  // ══════════════════════════════════════════════════════════════════

  async run(
    userPrompt: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    onAgentOutput?: ((agent: string, output: string) => void) | undefined,
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
    this.observer.recordInterrupt(userPrompt, "interrupt");

    while (this.stepCount < MAX_STEPS) {
      if (signal?.aborted) return this.abort("User aborted");

      // Collect context
      const contextSummary = this.pool.generateSummary();
      const interruptText = this.observer.getLatestInterruptText();
      const userInput = interruptText ?? userPrompt;

      const dialogueCheck = this.relay.shouldAskUser(userInput, this.pool,
        this.observer.getUnprocessedInterrupts().map((i) => i.text));
      if (dialogueCheck.needsDialogue && this.stepCount > 0) {
        this._running = false;
        return this.askUser(dialogueCheck.reason ?? "Confirmation needed", userPrompt);
      }

      // Manager decision
      const managerTask = this.buildManagerTask(userInput, contextSummary);
      const managerResult = await this.executeManager(managerTask, ctx, signal, onUpdate);

      if (isFailedResult(managerResult)) {
        this._running = false;
        return {
          content: [{ type: "text", text: `Manager decision failed: ${managerResult.stderr || "Unknown error"}` }],
          details: this.getDetails(), isError: true,
        };
      }

      const managerOutput = getFinalOutput(managerResult.messages);
      const decision = this.parseManagerDecision(managerOutput);

      if (decision.action === "complete") return this.complete(managerOutput, userPrompt);
      if (decision.action === "ask_user") return this.askUser(decision.message ?? "Confirmation needed", userPrompt);
      if (decision.action === "error") {
        this._running = false;
        return {
          content: [{ type: "text", text: `Manager decision error: ${decision.message}` }],
          details: this.getDetails(), isError: true,
        };
      }

      if (decision.action === "assign" && decision.mode && decision.steps && decision.steps.length > 0) {
        this.dispatchMode = decision.mode;

        // check permission (Lv1 requires relay decision confirmation)
        if (this.permission.checkOperation("manager" as AgentRole, "relay_decision").requiresConfirm) {
          this._running = false;
          const stepDesc = decision.steps.map((s, i) =>
            `  ${i + 1}. ${ROLE_DISPLAY_NAMES[s.agent]}: ${s.task.slice(0, 80)}`).join("\n");
          return this.askUser(
            `Manager proposes **${DISPATCH_MODE_LABELS[decision.mode]}** mode:\n${stepDesc}\n\nApprove?`,
            userPrompt,
          );
        }

        // execute dispatch
        const result = await this.executeDispatch(decision.mode, decision.steps, decision.context ?? contextSummary,
          ctx, signal, onUpdate);

        if (result.handoff) {
          // full-graph mode: Manager may specify next step, continue loop
          continue;
        }

        this.stepCount++;
        this.observer.markAllProcessed();

        if (result.failed) {
          this._running = false;
          return {
            content: [{ type: "text", text: result.failed }],
            details: this.getDetails(), isError: true,
          };
        }
      }
    }

    this._running = false;
    return {
      content: [{ type: "text", text: `Reached maximum steps (${MAX_STEPS}). Work may be incomplete.` }],
      details: this.getDetails(),
    };
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
  //  Manager decision
  // ══════════════════════════════════════════════════════════════════

  private buildManagerTask(userInput: string, contextSummary: string): string {
    const historySummary = this.agentHistory
      .map((h, i) => `[${i + 1}] ${h.agent}: ${h.task.slice(0, 100)} (${h.status})`)
      .join("\n");

    return [
      `You are the Manager in a multi-agent collaboration session.`,
      ``,
      `--- User Request ---`,
      userInput,
      ``,
      `--- Unprocessed Interrupts ---`,
      this.observer.getInterruptSummary() || "(none)",
      ``,
      `--- Execution History (${this.stepCount} steps) ---`,
      historySummary || "(none yet)",
      ``,
      contextSummary,
      ``,
      `--- Decision Requirements ---`,
      `First, assess task complexity:`,
      `- SIMPLE: Can be answered directly from what you know. Output:`,
      `  ACTION: complete`,
      `  REASON: <your answer>`,
      `- COMPLEX: Requires reading files, running code, or multiple perspectives. Output ACTION: assign to delegate.`,
      ``,
      `If all work is complete:`,
      `  ACTION: complete`,
      `  REASON: <why work is complete>`,
      ``,
      `If user input is needed:`,
      `  ACTION: ask_user`,
      `  MESSAGE: <clear question with options>`,
      ``,
      `Dispatch modes:`,
      `  1. one-to-one: delegate to one sub-agent, Manager decides next`,
      `  2. chain: sub-agents relay sequentially, use {previous} for prior output`,
      `  3. full-graph: fully connected graph, agents share context pool`,
      ``,
      `To assign work (all three modes use this format):`,
      `  ACTION: assign`,
      `  MODE: one-to-one | chain | full-graph`,
      `  STEPS:`,
      `    1. <agent1>: <task description>`,
      `    2. <agent2>: <task description>` +
        (contextSummary.includes("{previous}") ? " (can use {previous})" : ""),
      `  CONTEXT: <key context to pass>`,
      `  REASON: <why this mode and agents>`,
      ``,
      `Available sub-agents: coder, reviewer, architect, tester, documenter, devops, researcher${this._customAgentNames.length > 0 ? ", " + this._customAgentNames.join(", ") : ""}`,
    ].join("\n");
  }

  private parseManagerDecision(output: string): {
    action: "assign" | "ask_user" | "complete" | "error";
    mode?: DispatchMode;
    steps?: Array<{ agent: AgentRole; task: string }>;
    context?: string;
    message?: string;
  } {
    const raw = output;
    // strip markdown bold only, keep code blocks since ACTION may be inside them
    const cleaned = raw.replace(/\*\*(.+?)\*\*/g, "$1");
    const lines = cleaned.split("\n").map((l) => l.trim());

    // flexible ACTION: pattern matching
    const findVal = (...prefixes: string[]): string | undefined => {
      for (const prefix of prefixes) {
        for (const line of lines) {
          const m = line.match(new RegExp(`^\\s*${prefix}\\s*[:]\\s*(.+)$`, "i"));
          if (m) return m[1].trim();
        }
      }
      return undefined;
    };

    const actionRaw = findVal("ACTION", "action") ?? "";
    const action = actionRaw.toLowerCase();

    if (actionRaw === "" && (cleaned.includes("complete") || cleaned.includes("done") || cleaned.includes("finished"))) {
      return { action: "complete", message: "Manager determined work is complete" };
    }

    if (action.includes("complete")) {
      return { action: "complete", message: findVal("REASON") ?? "Work complete" };
    }
    if (action.includes("ask")) {
      return { action: "ask_user", message: findVal("MESSAGE") ?? "User confirmation needed" };
    }
    if (!action.includes("assign")) {
      if (cleaned.includes("ask_user")) {
        return { action: "ask_user", message: findVal("MESSAGE") ?? "Confirmation needed" };
      }
      return { action: "error", message: `Cannot parse Manager ACTION. Raw output: ${raw.slice(0, 300)}` };
    }

    // assign mode
    const modeRaw = (findVal("MODE") ?? "one-to-one").toLowerCase();
    let mode: DispatchMode = "one-to-one";
    if (modeRaw.includes("chain")) mode = "chain";
    else if (modeRaw.includes("graph") || modeRaw.includes("full")) mode = "full-graph";

    // parse STEPS
    const steps: Array<{ agent: AgentRole; task: string }> = [];
    let inSteps = false;

    for (const line of lines) {
      if (/^STEPS\s*[:]/i.test(line)) { inSteps = true; continue; }
      if (!inSteps) continue;
      if (/^(CONTEXT|REASON)\s*[:]/i.test(line)) break;
      if (line === "" && steps.length > 0) break;

      // match: number + agent: task (supports both EN/CN syntax)
      const m = line.match(/^[\d\-\.\*\)]+\s*\.?\s*([a-zA-Z]+)\s*[:]\s*(.+)$/);
      if (m) {
        const agentName = m[1].toLowerCase() as AgentRole;
        const task = m[2].trim();
        if (SUB_AGENT_ROLES.includes(agentName) || this._customAgentNames.includes(agentName)) {
          steps.push({ agent: agentName as any, task });
        }
      }
    }

    // fallback: parse STEPS from whole output if structured parse fails
    if (steps.length === 0) {
      for (const line of lines) {
        const m = line.match(/^[\d\-\.\*\)]+\s*\.?\s*([a-zA-Z]+)\s*[:]\s*(.+)$/);
        if (m) {
          const agentName = m[1].toLowerCase() as AgentRole;
          if (SUB_AGENT_ROLES.includes(agentName) || this._customAgentNames.includes(agentName)) {
            steps.push({ agent: agentName as any, task: m[2].trim() });
          }
        }
      }
    }

    if (steps.length === 0) {
      return { action: "error", message: `parseManagerDecision: no STEPS parsed\nRaw: ${raw.slice(0, 400)}` };
    }

    if (mode === "one-to-one" && steps.length > 1) {
      mode = "chain"; // multi-step but declared one-to-one, treat as chain
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

  private async executeManager(
    task: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
  ): Promise<import("./runner.ts").SingleResult> {
    const agents = discoverAgents(ctx.cwd, "both").agents;
    const mgr = agents.find((a) => a.name === "manager");
    const managerAgent = mgr ?? {
      name: "manager", systemPrompt: this.getManagerSystemPrompt(),
      tools: [], source: "user",
    };

    return runSingleAgent(
      ctx.cwd, [managerAgent as any], "manager", task,
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
    if (record.output) {
      this._lastOutputs[record.agent] = record.output;
      this._onAgentOutput?.(record.agent, record.output);
    }
    if ((result as any).usage) record.usage = (result as any).usage;
  }

  private updatePhase(agent: AgentRole): void {
    const phaseMap: Record<string, WorkPhase> = {
      coder: "execution", reviewer: "quality", architect: "planning",
      tester: "quality", documenter: "quality", devops: "execution", researcher: "reconnaissance",
    };
    const suggested = phaseMap[agent] ?? "execution";
    const currentIdx = ALL_PHASES.indexOf(this.currentPhase);
    const suggestedIdx = ALL_PHASES.indexOf(suggested);
    if (suggestedIdx > currentIdx) this.currentPhase = suggested;
  }

  // ══════════════════════════════════════════════════════════════════
  //  Output Helpers
  // ══════════════════════════════════════════════════════════════════

  private askUser(question: string, _origPrompt: string) {
    this._running = false;
    this.observer.managerAsk(question);
    return {
      content: [{ type: "text", text: `## Manager needs your input\n\n${question}\n\nReply with your thoughts, or use \`/resonanco:approve\` to confirm.` }],
      details: this.getDetails(),
    };
  }

  private complete(managerOutput: string, originalPrompt: string) {
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
          `**Manager Notes**:`,
          managerOutput,
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

  private getManagerSystemPrompt(): string {
    return [
      "You are the Manager, the central decision-maker in a multi-agent collaboration system.",
      "You are the only role that communicates directly with the user.",
      "You have NO tools to do any work yourself. You can ONLY delegate tasks to sub-agents.",
      "",
      "Your responsibilities:",
      "1. Analyze the user's request — is it simple (answer directly) or complex (needs sub-agents)?",
      "2. For simple requests (e.g. 'list files', 'what is X'), output ACTION: complete with the answer immediately to save time",
      "3. For complex requests that need reading files, running code, or multiple perspectives, use ACTION: assign to delegate",
      "4. The sub-agents (coder, reviewer, architect, etc.) have all the tools they need",
      "5. Consider the user's needs and any mid-stream feedback",
      "6. Reference all historical agent outputs (weighted)",
      "",
      "Dispatch modes:",
      "",
      "1. one-to-one — Delegate to a single sub-agent, then decide next steps",
      "   Use when: single clear task",
      '   Output: ACTION=assign, MODE=one-to-one, STEPS: 1. coder: implement X',
      "",
      "2. chain — Multiple sub-agents relay sequentially",
      "   Use when: multi-step work with dependencies",
      "   Use {previous} to reference previous agent output",
      '   Output: ACTION=assign, MODE=chain, STEPS: 1. researcher: research / 2. coder: implement based on {previous}',
      "",
      "3. full-graph — Fully connected graph, all agents share context pool",
      "   Use when: complex task requiring multi-angle parallel analysis then synthesis",
      '   Output: ACTION=assign, MODE=full-graph, STEPS: 1. coder: implement A / 2. tester: test B',
      "",
      "Available sub-agents:",
      "- Coder: implementation",
      "- Reviewer: quality review",
      "- Architect: design",
      "- Tester: testing",
      "- Documenter: documentation",
      "- DevOps: infrastructure",
      "- Researcher: investigation",
      ...this._customAgentNames.map((n) => `- ${n}: custom agent`),
      "",
      "Note: Only you can talk to the user. Follow the output format strictly.",
    ].join("\n");
  }

  reset(): void {
    this.stepCount = 0;
    this.currentPhase = "reception";
    this.currentAgent = null;
    this.agentHistory = [];
    this.dispatchMode = null;
    this.pool.reset();
    this.observer.reset();
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
