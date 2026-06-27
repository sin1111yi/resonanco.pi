/**
 * Resonanco — Multi-Agent Orchestration Framework
 *
 * Manager + 7 sub-agents, three dispatch modes, four permission levels.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ResonancoEngine } from "./core/engine.ts";
import { discoverAgents } from "./agents/registry.ts";
import { ROLE_DISPLAY_NAMES, DISPATCH_MODE_LABELS, PERMISSION_LABELS } from "./types/index.ts";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";

export default function (pi: ExtensionAPI) {
  const engine = new ResonancoEngine();
  const WIDGET_ID = "resonanco";

  // ── ANSI color helpers ────────────────────────────────────────
  const C = (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`;

  // Built-in agent definitions
  const BUILTIN_AGENTS: Record<string, { icon: string; color: number }> = {
    coder: { icon: "\u25C8", color: 36 },
    reviewer: { icon: "\u25C8", color: 33 },
    architect: { icon: "\u25C8", color: 35 },
    tester: { icon: "\u25C8", color: 92 },
    documenter: { icon: "\u25C8", color: 37 },
    devops: { icon: "\u25C8", color: 31 },
    researcher: { icon: "\u25C8", color: 94 },
    delivery: { icon: "\u25C8", color: 96 },
  };
  const BUILTIN_ORDER = ["coder","reviewer","architect","tester","documenter","devops","researcher","delivery"];
  const CUSTOM_COLORS = [91, 93, 96, 95, 100, 101, 102, 103, 104, 105, 106, 107];

  // Custom agents registry: persisted in agent config
  const CUSTOM_AGENTS_FILE = join(homedir(), ".pi", "resonanco-agents.json");
  const customAgents: Map<string, { icon: string; color: number }> = new Map();

  function loadCustomAgents() {
    try {
      if (existsSync(CUSTOM_AGENTS_FILE)) {
        const data = JSON.parse(readFileSync(CUSTOM_AGENTS_FILE, "utf-8"));
        if (typeof data === "object" && data !== null) {
          for (const [name, cfg] of Object.entries(data)) {
            const c = cfg as any;
            customAgents.set(name, { icon: c.icon ?? "\u25C6", color: c.color ?? 37 });
          }
        }
      }
    } catch {}
    engine.setCustomAgents([...customAgents.keys()]);
  }

  function saveCustomAgents() {
    try {
      const data: Record<string, any> = {};
      for (const [name, cfg] of customAgents) {
        data[name] = cfg;
      }
      writeFileSync(CUSTOM_AGENTS_FILE, JSON.stringify(data, null, 2));
    } catch {}
  }

  function getAllAgents(): string[] {
    return [...BUILTIN_ORDER, ...customAgents.keys()];
  }
  function getAgentIcon(name: string): string {
    return BUILTIN_AGENTS[name]?.icon ?? customAgents.get(name)?.icon ?? "\u25C6";
  }
  function getAgentColor(name: string): number {
    return BUILTIN_AGENTS[name]?.color ?? customAgents.get(name)?.color ?? 37;
  }

  // Braille spinner (npm-style)
  const BRAILLE = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  const BRAILLE_IDLE = "⣶"; // gray 6-dot braille for inactive agents
  const PERM_SHORT: Record<number, string> = {1:"Observer",2:"Cautious",3:"Semi-auto",4:"Full-auto"};
  const MODE_LABEL: Record<string, string> = {"one-to-one":"OneToOne","chain":"Chain","full-graph":"FullGraph"};

  let _frame = 0;

  function updateWidget(ctx?: any) {
    if (!ctx || !ctx.ui || ctx.mode !== "tui") return;
    _timerCtx = ctx;
    const status = engine.getStatus();

    const dotLine = getAllAgents().map((role) => {
      const working = status.running && status.activeAgents.includes(role);
      const ch = working ? BRAILLE[_frame] : BRAILLE_IDLE;
      const color = working ? getAgentColor(role) : 90;
      return C(color, ch);
    }).join(" ");

    const modeLabel = workMode === "plan" ? C(33, "Plan") : C(36, "Build");
    const parts: string[] = [`${modeLabel} \u2022 ${dotLine}`];

    // Step count + dispatch mode
    parts.push(`Step:${status.stepCount}`);
    parts.push(status.dispatchMode ? MODE_LABEL[status.dispatchMode] : "-");

    // Current agent(s): single name, or parallel count
    if (status.currentAgent) {
      const icon = getAgentIcon(status.currentAgent);
      const color = getAgentColor(status.currentAgent);
      parts.push(`${C(color, icon)} ${status.currentAgent}`);
    } else if (status.activeAgents.length > 0) {
      parts.push(`◈ ${status.activeAgents.length} agents`);
    }
    parts.push(PERM_SHORT[status.permissionLevel]);

    // Always show context pool
    parts.push(`Context:${status.contextStats.total}`);

    if (autoManager) parts.push("[auto]");

    const lines: string[] = [parts.join(" \u2022 ")];
    ctx.ui.setWidget(WIDGET_ID, lines);
  }

  // ── Work Mode: plan | build ──────────────────────────────────
  type WorkMode = "plan" | "build";
  let workMode: WorkMode = "build";
  const PLAN_TOOLS = new Set(["read", "grep", "find", "ls", "write"]);

  function setWorkMode(mode: WorkMode, ctx?: any) {
    workMode = mode;
    if (ctx?.ui) {
      ctx.ui.notify(mode === "plan" ? "Plan mode: read-only, design docs only" : "Build mode: full access", "info");
    }
    updateWidget(ctx);
  }

  // ── Auto Manager Mode ─────────────────────────────────────────
  let autoManager = false;
  function toggleAutoManager(ctx?: any) {
    autoManager = !autoManager;
    if (ctx?.ui) {
      ctx.ui.notify(
        autoManager ? "Auto Manager: ON (main dialog delegates to sub-agents)" : "Auto Manager: OFF",
        "info",
      );
    }
  }

  // ── Keyboard Shortcuts ────────────────────────────────────────

  pi.registerShortcut("ctrl+shift+r", {
    description: "Resonanco: cycle permission Lv1->Lv4",
    handler: async (ctx) => {
      const current = engine.permission.getGlobalLevel();
      const next = ((current % 4) + 1) as 1 | 2 | 3 | 4;
      engine.permission.setGlobalLevel(next);
      pi.sendMessage({
        customType: "resonanco",
        content: `Permission set to ${PERMISSION_LABELS[next]}`,
        display: true,
      });
      updateWidget(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+m", {
    description: "Resonanco: toggle auto Manager mode",
    handler: async (ctx) => {
      toggleAutoManager(ctx);
      updateWidget(ctx);
    },
  });

  pi.registerShortcut("ctrl+q", {
    description: "Resonanco: toggle plan/build mode",
    handler: async (ctx) => {
      setWorkMode(workMode === "plan" ? "build" : "plan", ctx);
      updateWidget(ctx);
    },
  });

  // ── Tool Schema ───────────────────────────────────────────────

  const ResonancoParams = Type.Object({
    prompt: Type.String({ description: "User request description" }),
    permissionLevel: Type.Optional(
      Type.Union(
        [Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4)],
        { description: "Permission level: 1=observer, 2=cautious, 3=semi-auto, 4=full-auto" },
      ),
    ),
  });

  // ── Main Tool: resonanco ──────────────────────────────────────

  pi.registerTool({
    name: "resonanco",
    label: "Resonanco",
    description: [
      "Multi-agent delegation tool. The main agent (you) acts as Manager and specifies agent/task assignments directly in the prompt.",
      "No internal Manager LLM — the prompt is parsed for MODE + STEPS, then sub-agents are dispatched.",
      "Sub-agents: Coder, Reviewer, Architect, Tester, Documenter, DevOps, Researcher.",
      "Dispatch modes: one-to-one (single agent), chain (sequential relay), full-graph (parallel).",
    ].join(" "),
    parameters: ResonancoParams,

    promptSnippet: "Delegate tasks to sub-agents",
    promptGuidelines: [
      "Use resonanco for ANY user request — code reviews, bug analysis, architecture discussions, and file inspections all benefit from multi-agent collaboration",
      "You (the main agent) are the Manager. Specify MODE + STEPS in the prompt to delegate to sub-agents.",
      "The prompt is parsed directly for delegation instructions — no internal Manager LLM.",
      "Keep prompts focused: one task per call, with clear agent assignments.",
    ],

    async execute(
      _toolCallId: string,
      params: { prompt: string; permissionLevel?: 1 | 2 | 3 | 4 },
      signal: AbortSignal | undefined,
      onUpdate: ((partial: any) => void) | undefined,
      ctx: any,
    ) {
      if (params.permissionLevel) {
        engine.permission.setGlobalLevel(params.permissionLevel);
      }

      const wrappedOnUpdate = onUpdate
        ? (partial: any) => { onUpdate(partial); updateWidget(ctx); }
        : undefined;

      let _parallelBuf: { agent: string; output: string; reasoning?: string }[] = [];
      let _parallelTimer: ReturnType<typeof setTimeout> | null = null;

      const onAgentOutput = (agent: string, output: string, reasoning?: string) => {
        const status = engine.getStatus();
        const isParallel = status.dispatchMode === "full-graph" && status.activeAgents.length > 1;

        const fmt = (a: string, o: string, r?: string) => {
          let t = `## ${a}`;
          if (r) t += `\n\n> ${r.slice(0, 800)}`;
          t += `\n\n${o}`;
          return t;
        };

        if (isParallel) {
          _parallelBuf.push({ agent, output, reasoning });
          if (_parallelTimer) clearTimeout(_parallelTimer);
          _parallelTimer = setTimeout(() => {
            const combined = _parallelBuf.map((p) => fmt(p.agent, p.output, p.reasoning)).join("\n\n---\n\n");
            pi.sendMessage({ customType: "resonanco", content: combined, display: true });
            _parallelBuf = [];
          }, 600);
        } else {
          pi.sendMessage({ customType: "resonanco", content: fmt(agent, output, reasoning), display: true });
        }
      };

      updateWidget(ctx);

      try {
        return await engine.run(params.prompt, ctx, signal, wrappedOnUpdate, onAgentOutput);
      } finally {
        updateWidget(ctx);
      }
    },

    renderCall(args: any, theme: any, _context: any) {
      const { renderResonancoCall } = require("./ui/renderer.ts");
      return renderResonancoCall(args, theme, _context);
    },

    renderResult(result: any, options: { expanded: boolean }, theme: any, _context: any) {
      const { renderResonancoResult } = require("./ui/renderer.ts");
      return renderResonancoResult(result, options, theme, _context);
    },
  });

  // ── Utility Tools ─────────────────────────────────────────────

  pi.registerTool({
    name: "resonanco_list_agents",
    label: "Resonanco: List Agents",
    description: "List all available agents",
    parameters: Type.Object({}),
    async execute(_id: string, _p: any, _s: any, _u: any, ctx: any) {
      const d = discoverAgents(ctx.cwd, "both");
      const fmt = (list: typeof d.agents, label: string) =>
        list.length > 0
          ? list.map((a) => `- **${a.name}**: ${a.description}`).join("\n")
          : `*(no ${label})*`;
      return {
        content: [{
          type: "text",
          text: [
            `## Resonanco Agents`,
            `### Main Agent`,
            fmt(d.agents.filter((a) => a.name === "manager"), "Manager"),
            `### Sub-agents (${d.agents.filter((a) => a.name !== "manager").length})`,
            fmt(d.agents.filter((a) => a.name !== "manager"), "sub-agents"),
          ].join("\n"),
        }],
        details: d,
      };
    },
  });

  pi.registerTool({
    name: "resonanco_status",
    label: "Resonanco: Status",
    description: "View current engine status",
    parameters: Type.Object({}),
    async execute(_id: string, _p: any, _s: any, _u: any, _ctx: any) {
      const s = engine.getStatus();
      return {
        content: [{
          type: "text",
          text: [
            `## Resonanco Status`,
            `Phase: ${s.phase}  |  Steps: ${s.stepCount}`,
            `Current Agent: ${s.currentAgent ?? "(idle)"}`,
            `Dispatch Mode: ${s.dispatchMode ? DISPATCH_MODE_LABELS[s.dispatchMode] : "N/A"}`,
            `Permission: ${PERMISSION_LABELS[s.permissionLevel]}`,
            `Context Pool: ${s.contextStats.total} entries`,
            ...Object.entries(s.contextStats.byRole).map(([r, c]) => `  - ${r}: ${c}`),
            ``,
            `History:`,
            ...(s.agentHistory.length > 0
              ? s.agentHistory.map((h, i) => `  ${i + 1}. ${h.agent}: ${h.task.slice(0, 60)} => ${h.status}`)
              : ["  (none)"]),
          ].join("\n"),
        }],
        details: s,
      };
    },
  });

  // ── Commands ──────────────────────────────────────────────────

  pi.registerCommand("resonanco:status", {
    description: "View Resonanco engine status",
    handler: async (_args: string, ctx: any) => {
      const s = engine.getStatus();
      ctx.ui.notify(
        `steps:${s.stepCount} phase:${s.phase} perm:Lv${s.permissionLevel} ctx:${s.contextStats.total}`,
        "info",
      );
    },
  });

  pi.registerCommand("resonanco:consolidate", {
    description: "Consolidate context pool: /resonanco:consolidate [--summarize] — merge entries from the same agent, optionally summarize via LLM",
    handler: async (_args: string, ctx: any) => {
      const doSummarize = _args.trim() === "--summarize";
      const entries = ((engine.pool as any).state?.entries ?? []) as any[];

      if (entries.length === 0) {
        ctx.ui.notify("Context pool is empty", "info");
        return;
      }

      // Group by agent
      const groups = new Map<string, any[]>();
      for (const entry of entries) {
        const key = entry.agentName ?? "unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(entry);
      }

      let consolidated = 0;
      const newEntries: any[] = [];

      for (const [agent, group] of groups) {
        if (group.length <= 1) {
          newEntries.push(...group);
          continue;
        }

        // Merge outputs
        const combined = group
          .map((e: any, i: number) => `[Entry ${i + 1}]\n${e.output}`)
          .join("\n\n---\n\n");

        if (doSummarize) {
          // LLM summarization via pi subprocess
          const summary = await new Promise<string>((resolve) => {
            const { spawn } = require("node:child_process");
            const prompt = `Summarize the following findings from \"${agent}\" into a concise single report. Keep all key technical details, drop redundancy.\n\n${combined.slice(0, 8000)}`;
            const proc = spawn("pi", ["--mode", "json", "-p", prompt], {
              stdio: ["ignore", "pipe", "pipe"],
            });
            let out = "";
            proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
            proc.on("close", () => {
              // Extract final text from JSON-mode output
              const lines = out.split("\n").filter(l => l.trim());
              for (const line of lines.reverse()) {
                try {
                  const ev = JSON.parse(line);
                  if (ev.type === "message_end" && ev.message) {
                    for (const part of ev.message.content || []) {
                      if (part.type === "text" && part.text) {
                        resolve(part.text.trim());
                        return;
                      }
                    }
                  }
                } catch {}
              }
              resolve(combined.slice(0, 2000) + "\n\n(summary failed, kept merged text)");
            });
          });

          newEntries.push({
            agentName: agent,
            role: group[0].role,
            phase: group[0].phase,
            output: summary,
            weight: Math.min(1.0, group.reduce((s: number, e: any) => s + e.weight, 0) * 0.5),
            createdAt: Date.now(),
            tags: [...(group[0].tags || []), "consolidated"],
          });
        } else {
          // Simple merge: keep latest, prefix with older entries
          const latest = { ...group[group.length - 1] };
          latest.output = `${combined.slice(0, 3000)}\n\n(consolidated from ${group.length} entries)`;
          latest.weight = Math.min(1.0, group.reduce((s: number, e: any) => s + e.weight, 0) * 0.5);
          latest.tags = [...(latest.tags || []), "consolidated"];
          newEntries.push(latest);
        }

        consolidated += group.length - 1;
      }

      (engine.pool as any).state.entries = newEntries;
      const stats = engine.pool.getStats();
      ctx.ui.notify(
        `Consolidated: removed ${consolidated} entries, ${stats.total} remaining` +
        (doSummarize ? " (LLM summarized)" : " (use --summarize for LLM summary)"),
        "info",
      );
      updateWidget(ctx);
    },
  });

  pi.registerCommand("resonanco:agents", {
    description: "List all agents",
    handler: async (_args: string, ctx: any) => {
      const d = discoverAgents(ctx.cwd, "both");
      const list = d.agents
        .map((a) => `${a.name === "manager" ? ">" : " "} ${a.name}: ${a.description.slice(0, 50)}`)
        .join("\n");
      ctx.ui.notify(`Resonanco (${d.agents.length}):\n${list}`, "info");
    },
  });

  pi.registerCommand("resonanco:permission", {
    description: "Set permission: /resonanco:permission <1-4> [agent]",
    handler: async (_args: string, ctx: any) => {
      const parts = _args.trim().split(/\s+/);
      const level = parseInt(parts[0], 10) as 1 | 2 | 3 | 4;
      if (level >= 1 && level <= 4) {
        if (parts.length >= 2) {
          engine.permission.setAgentLevel(parts[1] as any, level);
          ctx.ui.notify(`${parts[1]} permission set to Lv${level}`, "info");
        } else {
          engine.permission.setGlobalLevel(level);
          ctx.ui.notify(`Global permission set to Lv${level}: ${PERMISSION_LABELS[level]}`, "info");
        }
        updateWidget(ctx);
      } else {
        ctx.ui.notify("Usage: /resonanco:permission <1-4> [agent]", "error");
      }
    },
  });

  pi.registerCommand("resonanco:widget", {
    description: "Toggle widget display: /resonanco:widget [off]",
    handler: async (_args: string, ctx: any) => {
      if (_args.trim() === "off") {
        ctx.ui.setWidget(WIDGET_ID, undefined);
        ctx.ui.notify("Resonanco widget hidden", "info");
      } else {
        updateWidget(ctx);
        ctx.ui.notify("Resonanco widget shown", "info");
      }
    },
  });

  pi.registerCommand("resonanco:approve", {
    description: "Approve the Manager's plan",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.notify("Plan approved", "info");
      pi.sendUserMessage(
        _args.trim()
          ? `User approved with note: ${_args.trim()}`
          : "User approved the plan. Proceed."
      );
    },
  });

  pi.registerCommand("resonanco:reject", {
    description: "Reject the Manager's plan with feedback",
    handler: async (_args: string, ctx: any) => {
      const feedback = _args.trim() || "Please redesign the approach";
      ctx.ui.notify(`Rejected: ${feedback}`, "info");
      pi.sendUserMessage(`User rejected the plan. Feedback: ${feedback}`);
    },
  });

  // ── Workflow Shortcuts ────────────────────────────────────────

  const WORKFLOWS: Record<string, { label: string; prompt: (args: string) => string }> = {
    debate: {
      label: "Debate",
      prompt: (a) => `[Debate Mode] Organize coder/reviewer/architect/researcher to debate the following, presenting pros/cons and a final recommendation:\n\n${a}`,
    },
    explore: {
      label: "Explore",
      prompt: (a) => `[Explore Mode] Delegate to researcher + architect to deeply investigate the following topic and produce a comprehensive report:\n\n${a}`,
    },
    implement: {
      label: "Implement",
      prompt: (a) => `[Implement Mode] Use coder -> reviewer -> tester chain to complete the following task:\n\n${a}`,
    },
    review: {
      label: "Review",
      prompt: (a) => `[Review Mode] Delegate to reviewer + architect to jointly review the following and provide improvement suggestions:\n\n${a}`,
    },
    supervise: {
      label: "Supervise",
      prompt: (a) => `[Supervise Mode] Lv1 permission, Manager oversees every step. Each step requires user confirmation before execution:\n\n${a}`,
    },
  };

  for (const [name, wf] of Object.entries(WORKFLOWS)) {
    pi.registerCommand(`resonanco:${name}`, {
      description: `${wf.label} mode: /resonanco:${name} <task description>`,
      handler: async (_args: string, ctx: any) => {
        if (!_args.trim()) {
          ctx.ui.notify(`Usage: /resonanco:${name} <task description>`, "error");
          return;
        }
        if (name === "supervise") {
          engine.permission.setGlobalLevel(1);
          updateWidget(ctx);
        }
        pi.sendUserMessage(wf.prompt(_args.trim()));
        ctx.ui.notify(`${wf.label} mode triggered`, "info");
      },
    });
  }

  pi.registerCommand("resonanco:auto", {
    description: "Toggle auto Manager mode: /resonanco:auto [on|off]",
    handler: async (_args: string, ctx: any) => {
      const arg = _args.trim().toLowerCase();
      if (arg === "on") {
        if (!autoManager) toggleAutoManager(ctx);
      } else if (arg === "off") {
        if (autoManager) toggleAutoManager(ctx);
      } else {
        toggleAutoManager(ctx);
      }
      updateWidget(ctx);
    },
  });

  pi.registerCommand("resonanco:mode", {
    description: "Set work mode: /resonanco:mode [plan|build]",
    handler: async (_args: string, ctx: any) => {
      const arg = _args.trim().toLowerCase();
      if (arg === "plan" || arg === "build") {
        setWorkMode(arg, ctx);
        pi.sendMessage({
          customType: "resonanco",
          content: arg === "plan"
            ? "Plan mode: read-only. You can read files and write design documents, but cannot modify code or run commands."
            : "Build mode: full access. All tools available, subject to permission level.",
          display: true,
        });
      } else {
        ctx.ui.notify(`Current mode: ${workMode === "plan" ? "Plan (read-only, design docs)" : "Build (full access)"}`, "info");
      }
    },
  });

  pi.registerCommand("resonanco:register-agent", {
    description: "Register a custom sub-agent: /resonanco:register-agent <name> <description>",
    handler: async (_args: string, ctx: any) => {
      const parts = _args.trim().split(/\s+/);
      const name = parts[0];
      const desc = parts.slice(1).join(" ");
      if (!name || !desc) {
        ctx.ui.notify("Usage: /resonanco:register-agent <name> <description>", "error");
        return;
      }
      if (BUILTIN_ORDER.includes(name) || customAgents.has(name)) {
        ctx.ui.notify(`Agent '${name}' already exists`, "error");
        return;
      }
      const agentDir = join(homedir(), ".pi", "agent", "agents");
      const agentFile = join(agentDir, `${name}.md`);
      const templatePath = join(homedir(), ".pi", "agent", "extensions", "resonanco", "docs", "agent-template.md");
      let md = "";
      try {
        md = readFileSync(templatePath, "utf-8")
          .replace(/\{\{name\}\}/g, name)
          .replace(/\{\{description\}\}/g, desc);
      } catch {
        // fallback if template missing
        md = `---\nname: ${name}\ndescription: ${desc}\nrole: ${name}\ntools: read, write, edit, bash, grep, find, ls\n---\n\nYou are a ${name}. ${desc}\n\n## Core Responsibilities\n- ${desc}\n\n## Working Style\n- Read relevant context before acting\n- Make focused changes\n- Report results when done\n`;
      }
      try {
        writeFileSync(agentFile, md);
      } catch {
        ctx.ui.notify("Failed to create agent file", "error");
        return;
      }
      const colorIdx = customAgents.size % CUSTOM_COLORS.length;
      customAgents.set(name, { icon: "\u25C6", color: CUSTOM_COLORS[colorIdx] });
      engine.setCustomAgents([...customAgents.keys()]);
      saveCustomAgents();
      updateWidget(ctx);
      ctx.ui.notify(`Registered custom agent: ${name}`, "info");
      // Ask the main agent to refine the agent definition
      pi.sendUserMessage([
        { type: "text", text: `The custom agent "${name}" was just registered with description: "${desc}". Please use resonanco to delegate to documenter to refine its definition in ${agentFile} — improve the system prompt and add proper responsibilities and working style.` },
      ]);
    },
  });

  pi.registerCommand("resonanco:unregister-agent", {
    description: "Remove a custom sub-agent: /resonanco:unregister-agent <name>",
    handler: async (_args: string, ctx: any) => {
      const name = _args.trim();
      if (!name || !customAgents.has(name)) {
        ctx.ui.notify(`Custom agent '${name}' not found`, "error");
        return;
      }
      customAgents.delete(name);
      // Remove agent file if it exists
      const agentDir = join(homedir(), ".pi", "agent", "agents");
      const agentFile = join(agentDir, `${name}.md`);
      try { unlinkSync(agentFile); } catch {}
      engine.setCustomAgents([...customAgents.keys()]);
      saveCustomAgents();
      updateWidget(ctx);
      ctx.ui.notify(`Unregistered custom agent: ${name}`, "info");
    },
  });

  // ── Lifecycle Events ──────────────────────────────────────────

  let _timerCtx: any = null;
  let _timerId: ReturnType<typeof setInterval> | null = null;

  function startWidgetTimer(ctx: any) {
    _timerCtx = ctx;
    if (_timerId === null && ctx.ui && ctx.mode === "tui") {
      _timerId = setInterval(() => {
        _frame = (_frame + 1) % BRAILLE.length;
        updateWidget(_timerCtx);
      }, 80);
    }
  }

  function stopWidgetTimer() {
    if (_timerId !== null) {
      clearInterval(_timerId);
      _timerId = null;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    startWidgetTimer(ctx);
    updateWidget(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopWidgetTimer();
  });

  // Block restricted tools in plan mode
  pi.on("tool_call", async (event, ctx) => {
    if (workMode !== "plan") return;
    if (!PLAN_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Plan mode: tool '${event.toolName}' is not available. Only read, grep, find, ls, write are allowed in plan mode.`,
      };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const modeNote = workMode === "plan"
      ? "\n**Mode: PLAN** — Read-only planning mode. You can ONLY read files and write design documents. Do NOT attempt to call bash, edit, or any other tool — they will be blocked. If you need code changes, switch to BUILD mode with `/resonanco:mode build` or ctrl+q."
      : "\n**Mode: BUILD** — Full access mode. All tools available. Respect the current permission level.\n";

    let extra = modeNote;

    if (autoManager) {
      extra += [
        "\n\n**Resonanco Auto Manager mode is active. You are the Manager.**",
        "",
        "The `resonanco` tool directly parses MODE + STEPS from your prompt and dispatches sub-agents.",
        "There is no internal Manager LLM — you decide the delegation plan.",
        "",
        "For every user request, call `resonanco` with structured instructions:",
        "  MODE: one-to-one | chain | full-graph",
        "  STEPS:",
        "    1. <agent>: <task>",
        "    2. <agent>: <task>",
        "",
        "Available sub-agents:",
        "- coder: write/modify code",
        "- reviewer: code review",
        "- architect: architecture design",
        "- tester: testing",
        "- documenter: documentation",
        "- devops: infrastructure/deployment",
        "- researcher: research and analysis",
        ...Array.from(customAgents.keys()).map((n) => `- ${n}: custom agent`),
      ].join("\n");
    }

    return {
      systemPrompt: (event.systemPrompt ?? "") + "\n\n" + extra,
    };
  });

  // Load persisted custom agents at startup
  loadCustomAgents();
}
