/**
 * Resonanco — Relay Decision Engine
 *
 * Manager decision algorithm: score each sub-agent, select best candidate.
 *
 * Score(agent) = W_role × fit + W_history × rel + W_user × inf + W_phase × phase
 */

import type { AgentRole, RelayDecision, RelayFactors } from "../types/index.ts";
import { DEFAULT_CONFIG, SUB_AGENT_ROLES } from "../types/index.ts";
import type { ResonancoConfig } from "../types/index.ts";
import { classifyDemand, getRoleFit, getPhaseFit, getAllRoleFits } from "../agents/roles.ts";
import type { ContextPool } from "../context/pool.ts";

export class RelayDecider {
  private config: ResonancoConfig;

  constructor(config?: Partial<ResonancoConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate composite scores for all sub-agents
   */
  scoreAll(
    task: string,
    pool: ContextPool,
    userInterrupts: string[],
    currentPhase: import("../types/index.ts").WorkPhase,
    consecutiveMap: Map<AgentRole, number>,
    lastAgent?: AgentRole,
  ): RelayDecision {
    const demand = classifyDemand(task);
    const roleFits = getAllRoleFits(demand);

    // Calculate scores per dimension
    const scores = new Map<AgentRole, number>();
    const details = new Map<AgentRole, { roleFit: number; history: number; userInf: number; phase: number }>();

    for (const agent of SUB_AGENT_ROLES) {
      // 1. Role fit score
      const roleFit = roleFits[agent] ?? 0;

      // 2. Historical relevance — check agent weight in context pool
      const historyEntries = pool.getRecentByAgent(agent, 3);
      const historyRelevance = historyEntries.length > 0
        ? historyEntries.reduce((sum, e) => sum + e.weight, 0) / historyEntries.length
        : 0.1;

      // 3. user influence — whether user mentioned this agent
      const userInfluence = this.calcUserInfluence(userInterrupts, agent, task);

      // 4. Phase match — current phase reference
      const phaseFit = getPhaseFit(currentPhase, agent);

      // composite score
      const score =
        this.config.roleFitWeight * roleFit +
        this.config.historyWeight * historyRelevance +
        this.config.userInfluenceWeight * userInfluence +
        this.config.phaseWeight * phaseFit;

      scores.set(agent, score);
      details.set(agent, { roleFit, history: historyRelevance, userInf: userInfluence, phase: phaseFit });
    }

    // apply penalty
    this.applyPenalties(scores, consecutiveMap, lastAgent);

    // sort and select best
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1]);

    const bestAgent = sorted[0][0];
    const bestScore = sorted[0][1];

    // If all scores very low, may need user dialogue
    const confidence = bestScore > 0.8 ? "high" : bestScore > 0.5 ? "medium" : "low";

    return {
      nextAgent: bestAgent,
      confidence: bestScore,
      reasoning: this.buildReasoning(bestAgent, bestScore, details.get(bestAgent)!, demand),
      alternatives: sorted.slice(1, 4).map(([agent, score]) => ({ agent, score })),
    };
  }

  /**
   * Determine if user dialogue is needed
   */
  shouldAskUser(
    task: string,
    pool: ContextPool,
    userInterrupts: string[],
  ): { needsDialogue: boolean; reason?: string } {
    // Scenario 1: unclear requirements - empty context or vague task
    if (pool.getStats().total === 0 && task.length < 20) {
      return { needsDialogue: true, reason: "Requirements unclear, need more information" };
    }

    // Scenario 2: user just interrupted - handle user input first
    if (userInterrupts.length > 0) {
      const lastInterrupt = userInterrupts[userInterrupts.length - 1];
      if (lastInterrupt.endsWith("?")) {
        return { needsDialogue: true, reason: "User asked a question, needs an answer" };
      }
    }

    // scenario 3: detect conflict — e.g. simultaneous write and review
    const recentEntries = pool.getRecent(5);
    const roles = new Set(recentEntries.map((e) => e.role));
    if (roles.has("coder") && roles.has("reviewer") && recentEntries.length >= 4) {
      const lastRole = recentEntries[recentEntries.length - 1]?.role;
      if (lastRole === "coder" && recentEntries.filter((e) => e.role === "reviewer").length > 0) {
        // coder/reviewer ping-pong may indicate a loop
        return { needsDialogue: true, reason: "Possible loop detected, need to confirm direction" };
      }
    }

    // scenario 4: low confidence
    const userHistory = userInterrupts.length > 0 ? userInterrupts.join(" ") : "";
    const score = this.scoreAll(task, pool, userInterrupts, "execution", new Map());
    if (score.confidence < 0.4) {
      return { needsDialogue: true, reason: "Low confidence in next decision, seeking user input" };
    }

    return { needsDialogue: false };
  }

  private calcUserInfluence(interrupts: string[], agent: AgentRole, task: string): number {
    if (interrupts.length === 0) return 0;

    const combined = interrupts.join(" ").toLowerCase();
    const agentKeywords: Record<AgentRole, string[]> = {
      coder: ["coder", "implement", "write", "code"],
      reviewer: ["reviewer", "review", "check", "quality"],
      architect: ["architect", "design", "architecture"],
      manager: [],
      tester: ["tester", "test", "verify", "testing"],
      documenter: ["documenter", "doc", "readme", "documentation"],
      devops: ["devops", "Deployment", "ci", "cd", "docker"],
      researcher: ["researcher", "research", "investigate", "analyze"],
    };

    const keywords = agentKeywords[agent] ?? [];
    let score = 0;

    for (const kw of keywords) {
      if (combined.includes(kw)) score += 0.15;
    }

    // If user explicitly mentioned a role, bonus
    if (combined.includes(agent)) score += 0.5;
    if (combined.includes("all")|| combined.includes("all")) score += 0.1;

    return Math.min(score, 1.0);
  }

  private applyPenalties(
    scores: Map<AgentRole, number>,
    consecutiveMap: Map<AgentRole, number>,
    lastAgent?: AgentRole,
  ): void {
    // Penalty for consecutive same-agent calls
    if (lastAgent) {
      const consecutive = consecutiveMap.get(lastAgent) ?? 0;
      if (consecutive >= 2) {
        const penalty = (consecutive - 1) * 0.15;
        scores.set(lastAgent, Math.max(0, (scores.get(lastAgent) ?? 0) - penalty));
      }
    }
  }

  private buildReasoning(
    agent: AgentRole,
    score: number,
    details: { roleFit: number; history: number; userInf: number; phase: number },
    demand: string,
  ): string {
    const displayNames: Record<AgentRole, string> = {
      coder: "Coder", reviewer: "Reviewer", architect: "Architect",
      manager: "Manager", tester: "Tester", documenter: "Documenter",
      devops: "DevOps", researcher: "Researcher",
    };

    const parts: string[] = [
      `Selected ${displayNames[agent]} (score ${score.toFixed(2)})`,
      `  Requirement type: ${demand}`,
      `  Role fit: ${(details.roleFit * 100).toFixed(0)}%`,
      `  History: ${(details.history * 100).toFixed(0)}%`,
      `  user inf: ${(details.userInf * 100).toFixed(0)}%`,
      `  Phase: ${(details.phase * 100).toFixed(0)}%`,
    ];

    return parts.join("\n");
  }
}
