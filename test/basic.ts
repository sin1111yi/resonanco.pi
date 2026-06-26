/**
 * Resonanco — Basic Tests
 *
 * These verify the core orchestrator and agent registry work.
 * Run with: deno test or node --experimental-strip-types test/basic.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverAgents } from "../src/agents/registry.ts";
import { Orchestrator } from "../src/core/orchestrator.ts";
import { BudgetManager } from "../src/core/context.ts";
import { topologicalSort } from "../src/workflows/dag.ts";

// ─── Orchestrator ──────────────────────────────────────────────────

describe("Orchestrator", () => {
  it("creates with default config", () => {
    const orch = new Orchestrator();
    assert.equal(orch.config.maxParallelTasks, 8);
    assert.equal(orch.config.maxConcurrency, 4);
    assert.equal(orch.config.defaultAgentScope, "user");
  });

  it("merges custom config", () => {
    const orch = new Orchestrator({ maxParallelTasks: 16, maxConcurrency: 8 });
    assert.equal(orch.config.maxParallelTasks, 16);
    assert.equal(orch.config.maxConcurrency, 8);
  });

  it("registers built-in workflow patterns", () => {
    const orch = new Orchestrator();
    const patterns = orch.getRegisteredPatterns();
    assert.ok(patterns.includes("chain"));
    assert.ok(patterns.includes("fan-out-fan-in"));
    assert.ok(patterns.includes("dag"));
    assert.ok(patterns.includes("supervisor"));
    assert.ok(patterns.includes("debate"));
  });
});

// ─── Budget Manager ────────────────────────────────────────────────

describe("BudgetManager", () => {
  it("tracks usage per agent", () => {
    const bm = new BudgetManager();
    bm.trackUsage("scout", {
      input: 1000, output: 500, cacheRead: 0, cacheWrite: 0,
      cost: 0.01, contextTokens: 1500, turns: 3,
    });
    const total = bm.getTotalUsage();
    assert.equal(total.input, 1000);
    assert.equal(total.turns, 3);
  });

  it("allows within budget", () => {
    const bm = new BudgetManager();
    bm.trackUsage("scout", {
      input: 1000, output: 500, cacheRead: 0, cacheWrite: 0,
      cost: 0.01, contextTokens: 1500, turns: 3,
    });
    assert.equal(bm.checkBudget("scout").allowed, true);
  });

  it("blocks over max turns", () => {
    const bm = new BudgetManager();
    bm.setBudget("scout", { maxTurns: 2 });
    bm.trackUsage("scout", {
      input: 100, output: 100, cacheRead: 0, cacheWrite: 0,
      cost: 0.01, contextTokens: 200, turns: 3,
    });
    assert.equal(bm.checkBudget("scout").allowed, false);
  });

  it("resets correctly", () => {
    const bm = new BudgetManager();
    bm.trackUsage("scout", {
      input: 1000, output: 500, cacheRead: 0, cacheWrite: 0,
      cost: 0.01, contextTokens: 1500, turns: 3,
    });
    bm.reset();
    const total = bm.getTotalUsage();
    assert.equal(total.turns, 0);
  });
});

// ─── Agent Registry ────────────────────────────────────────────────

describe("Agent Registry", () => {
  it("discovers agents from user directory", () => {
    // This test requires actual agent files to be present
    // In CI, we'd mock the filesystem
    const result = discoverAgents("/tmp", "user");
    assert.ok(Array.isArray(result.agents));
  });
});

// ─── DAG Topological Sort ──────────────────────────────────────────

describe("DAG Topological Sort", () => {
  it("sorts simple dependency chain", () => {
    const nodes = [
      { id: "a", agent: "scout", task: "task a", dependsOn: [] },
      { id: "b", agent: "planner", task: "task b", dependsOn: ["a"] },
      { id: "c", agent: "worker", task: "task c", dependsOn: ["b"] },
    ];
    const levels = topologicalSort(nodes);
    assert.equal(levels.length, 3);
    assert.equal(levels[0].nodes[0].id, "a");
    assert.equal(levels[1].nodes[0].id, "b");
    assert.equal(levels[2].nodes[0].id, "c");
  });

  it("handles parallel deps", () => {
    const nodes = [
      { id: "a", agent: "scout", task: "task a", dependsOn: [] },
      { id: "b", agent: "scout", task: "task b", dependsOn: [] },
      { id: "c", agent: "planner", task: "task c", dependsOn: ["a", "b"] },
    ];
    const levels = topologicalSort(nodes);
    assert.equal(levels.length, 2);
    assert.equal(levels[0].nodes.length, 2);
    assert.equal(levels[1].nodes[0].id, "c");
  });

  it("detects cycles", () => {
    const nodes = [
      { id: "a", agent: "scout", task: "task", dependsOn: ["b"] },
      { id: "b", agent: "scout", task: "task", dependsOn: ["a"] },
    ];
    assert.throws(() => topologicalSort(nodes), /Cycle detected/);
  });
});
