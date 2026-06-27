/**
 * Resonanco — Weighted Context Pool
 *
 * Store all sub-agent output history with weight management.
 * Supports decay, boost, zeroing, and summary generation.
 */

import type { AgentRole, ContextEntry, ContextPoolState, WorkPhase } from "../types/index.ts";
import { DEFAULT_CONFIG } from "../types/index.ts";

export class ContextPool {
  private state: ContextPoolState;
  private decayFactor: number;
  private weightCap: number;

  constructor(decayFactor?: number, weightCap?: number) {
    this.decayFactor = decayFactor ?? DEFAULT_CONFIG.contextDecayFactor;
    this.weightCap = weightCap ?? DEFAULT_CONFIG.contextWeightCap;
    this.state = { entries: [], globalWeight: 1.0 };
  }

  /** Add new entry */
  add(
    agentName: string,
    role: AgentRole,
    phase: WorkPhase,
    output: string,
    weight?: number,
    tags?: string[],
  ): void {
    this.state.entries.push({
      agentName,
      role,
      phase,
      output,
      weight: weight ?? 1.0,
      createdAt: Date.now(),
      tags,
    });
  }

  /** Apply decay to all history entries */
  decay(): void {
    for (const entry of this.state.entries) {
      entry.weight *= this.decayFactor;
    }
    this.state.globalWeight *= this.decayFactor;
    this.cleanup();
  }

  /** Boost weight of recent agent output */
  boost(agentName: string, amount: number = 0.2): void {
    const recent = this.getRecentByAgent(agentName, 1);
    for (const entry of recent) {
      entry.weight = Math.min(this.weightCap, entry.weight + amount);
    }
  }

  /** Zero out weight for a specific entry */
  zeroOut(agentName?: string, index?: number): void {
    if (index !== undefined && this.state.entries[index]) {
      this.state.entries[index].weight = 0;
    } else if (agentName) {
      for (const entry of this.state.entries) {
        if (entry.agentName === agentName) {
          entry.weight = 0;
        }
      }
    }
    this.cleanup();
  }

  /** Mark as user approved */
  approve(agentName?: string): void {
    if (agentName) {
      const recent = this.getRecentByAgent(agentName, 1);
      for (const entry of recent) {
        entry.isApproved = true;
        entry.weight = this.weightCap; // restore to 1.0
      }
    } else {
      // Most recent entry
      const last = this.state.entries[this.state.entries.length - 1];
      if (last) {
        last.isApproved = true;
        last.weight = this.weightCap;
      }
    }
  }

  /** Get all entries sorted by weight */
  getWeightedEntries(): ContextEntry[] {
    return [...this.state.entries].sort((a, b) => b.weight - a.weight);
  }

  /** Get N most recent entries (by time) */
  getRecent(count: number): ContextEntry[] {
    return this.state.entries.slice(-count);
  }

  /** Get N most recent entries for a specific agent */
  getRecentByAgent(agentName: string, count: number = 1): ContextEntry[] {
    return this.state.entries
      .filter((e) => e.agentName === agentName)
      .slice(-count);
  }

  /** Generate weighted context summary */
  generateSummary(maxEntries?: number): string {
    const sorted = this.getWeightedEntries();
    const totalWeight = sorted.reduce((sum, e) => sum + e.weight, 0);
    if (totalWeight === 0) return "";

    // take top 80% cumulative weight entries, or maxEntries
    let cumulative = 0;
    const threshold = 0.8;
    const selected: ContextEntry[] = [];
    const limit = maxEntries ?? 20;

    for (const entry of sorted) {
      if (entry.weight <= 0) continue;
      selected.push(entry);
      cumulative += entry.weight / totalWeight;
      if (cumulative >= threshold && selected.length >= 3) break;
      if (selected.length >= limit) break;
    }

    // reorder by time
    selected.sort((a, b) => a.createdAt - b.createdAt);

    const lines: string[] = ["--- Context Pool Summary ---\n"];

    for (const entry of selected) {
      const roleEmoji = this.getRoleEmoji(entry.role);
      const approved = entry.isApproved ? " user approved" : "";
      const phaseLabel = entry.phase;
      lines.push(
        `[${roleEmoji} ${entry.agentName} | w:${entry.weight.toFixed(2)} | phase:${phaseLabel}]${approved}`,
      );
      // truncate output to 500 chars
      const outputPreview = entry.output.length > 500
        ? entry.output.slice(0, 500) + "\n...(truncated)"
        : entry.output;
      lines.push(outputPreview);
      lines.push("");
    }

    return lines.join("\n");
  }

  /** Remove low-weight entries */
  private cleanup(): void {
    this.state.entries = this.state.entries.filter((e) => e.weight >= 0.01);
  }

  /** Get stats */
  getStats(): { total: number; byRole: Record<string, number> } {
    const byRole: Record<string, number> = {};
    for (const entry of this.state.entries) {
      byRole[entry.role] = (byRole[entry.role] ?? 0) + 1;
    }
    return { total: this.state.entries.length, byRole };
  }

  /**
   * Consolidate: merge entries from the same agent into a single summary.
   * Keeps the most recent full output per agent, appends a merge note.
   * Returns the number of entries removed.
   */
  consolidate(): number {
    const before = this.state.entries.length;
    const seen = new Set<string>();
    const merged: ContextEntry[] = [];

    // Process in reverse (newest first) to keep latest output
    for (let i = this.state.entries.length - 1; i >= 0; i--) {
      const entry = this.state.entries[i];
      if (seen.has(entry.agentName)) {
        // Find the kept entry and append a reference
        const kept = merged.find((m) => m.agentName === entry.agentName);
        if (kept) {
          kept.output = `[+${entry.createdAt.toFixed(0)} merged] ${entry.output.slice(0, 200)}\n---\n${kept.output}`;
          kept.weight = Math.min(this.weightCap, kept.weight + entry.weight * 0.3);
        }
        continue;
      }
      seen.add(entry.agentName);
      merged.push({ ...entry });
    }

    // Restore chronological order
    merged.reverse();
    this.state.entries = merged;
    return before - this.state.entries.length;
  }

  /** Reset */
  reset(): void {
    this.state = { entries: [], globalWeight: 1.0 };
  }

  private getRoleEmoji(role: AgentRole): string {
    const prefixes: Record<AgentRole, string> = {
      coder: "[C]", reviewer: "[R]", architect: "[A]",
      manager: "[M]", tester: "[T]", documenter: "[D]",
      devops: "[O]", researcher: "[S]",
    };
    return prefixes[role] ?? "[?]";
  }
}
