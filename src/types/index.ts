/**
 * Resonanco v2 — Core type definitions
 */

// ─── Agent Roles ────────────────────────────────────────────────────

/**
 * Main Agent (Manager) — talks directly with user, no code operations.
 * Sub-agents — execute specific tasks, no direct user dialogue.
 */
export type AgentRole =
  | "coder"        // [sub] Coder — implementation
  | "reviewer"     // [sub] Reviewer — code review
  | "architect"    // [sub] Architect — design
  | "manager"      // [main] Manager — central decision-making
  | "tester"      // [sub] Tester — testing
  | "documenter"   // [sub] Documenter — documentation
  | "devops"      // [sub] DevOps — infrastructure
  | "researcher"  // [sub] Researcher — investigation
  | "delivery";   // [sub] Delivery — summaries, reports, commit logs

/** Main agent role */
export const MAIN_AGENT_ROLE: AgentRole = "manager";

/** Sub-agent role list */
export const SUB_AGENT_ROLES: AgentRole[] = [
  "coder",
  "reviewer",
  "architect",
  "tester",
  "documenter",
  "devops",
  "researcher",
  "delivery",
];

/** Check if a role is a sub-agent */
export function isSubAgent(role: AgentRole): boolean {
  return role !== "manager";
}

/** Check if a role is the main agent */
export function isMainAgent(role: AgentRole): boolean {
  return role === "manager";
}

export const ALL_ROLES: AgentRole[] = ["manager", ...SUB_AGENT_ROLES];

export const ROLE_DISPLAY_NAMES: Record<AgentRole, string> = {
  coder: "Coder",
  reviewer: "Reviewer",
  architect: "Architect",
  manager: "Manager",
  tester: "Tester",
  documenter: "Documenter",
  devops: "DevOps",
  researcher: "Researcher",
  delivery: "Delivery",
};

export const ROLE_DISPLAY_WITH_TAG: Record<AgentRole, string> = {
  coder: "[sub] Coder",
  reviewer: "[sub] Reviewer",
  architect: "[sub] Architect",
  manager: "[main] Manager",
  tester: "[sub] Tester",
  documenter: "[sub] Documenter",
  devops: "[sub] DevOps",
  researcher: "[sub] Researcher",
  delivery: "[sub] Delivery",
};

export const ROLE_EMOJIS: Record<AgentRole, string> = {
  coder: "",
  reviewer: "",
  architect: "",
  manager: "",
  tester: "",
  documenter: "",
  devops: "",
  researcher: "",
  delivery: "",
};

// ─── Work Phases ────────────────────────────────────────────────────

export type WorkPhase =
  | "reception"      // Phase 1: requirements
  | "reconnaissance" // Phase 2: investigation
  | "planning"       // Phase 3: planning
  | "execution"      // Phase 4: execution
  | "quality";       // Phase 5: quality review

export const ALL_PHASES: WorkPhase[] = [
  "reception",
  "reconnaissance",
  "planning",
  "execution",
  "quality",
];

export const PHASE_DISPLAY_NAMES: Record<WorkPhase, string> = {
  reception: "Reception",
  reconnaissance: "Reconnaissance",
  planning: "Planning",
  execution: "Execution",
  quality: "QA",
};

/**
 * Agents are decoupled from phases — any agent can work at any phase.
 * The Manager chooses agents based on context and needs, not a fixed mapping.
 * These phases serve as work-status markers, not agent selection constraints.
 */

// ─── Permission Levels ──────────────────────────────────────────────

export type PermissionLevel = 1 | 2 | 3 | 4;

export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  1: "Lv1 Observer — confirm every step",
  2: "Lv2 Cautious — confirm writes only",
  3: "Lv3 Semi-auto — confirm dangerous ops only",
  4: "Lv4 Full-auto — no confirmation",
};

/** Operations that require confirmation per level */
export const PERMISSION_CONFIRM_READ: Record<PermissionLevel, boolean> = {
  1: true,   // read ops need confirm
  2: false,  // read ops auto
  3: false,
  4: false,
};

export const PERMISSION_CONFIRM_WRITE: Record<PermissionLevel, boolean> = {
  1: true,   // write ops need confirm
  2: true,   // write ops need confirm
  3: false,  // write ops auto
  4: false,
};

export const PERMISSION_CONFIRM_DANGEROUS: Record<PermissionLevel, boolean> = {
  1: true,
  2: true,   // dangerous ops need confirm
  3: true,   // dangerous ops need confirm
  4: false,  // dangerous ops auto
};

// ─── Agent Instance ─────────────────────────────────────────────────

export interface AgentInstance {
  name: string;
  role: AgentRole;
  description: string;
  systemPrompt: string;
  model?: string;
  tools?: string[];
  source: "user" | "project";
}

// ─── Context Pool Entry ─────────────────────────────────────────────

export interface ContextEntry {
  agentName: string;
  role: AgentRole;
  phase: WorkPhase;
  output: string;
  weight: number;      // 0.0 ~ 1.0
  createdAt: number;
  isApproved?: boolean; // whether user approved
}

export interface ContextPoolState {
  entries: ContextEntry[];
  globalWeight: number; // global decay factor
}

export interface AgentCallRecord {
  agent: AgentRole;
  task: string;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "aborted";
  output?: string;
  usage?: UsageStats;
}

// ─── Task / Execution ───────────────────────────────────────────────

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

// ─── Dispatch Modes ────────────────────────────────────────────────

/** Manager dispatch mode for work delegation */
export type DispatchMode = "one-to-one" | "chain" | "full-graph";

export const DISPATCH_MODE_LABELS: Record<DispatchMode, string> = {
  "one-to-one": "One-to-one",
  "chain": "Chain",
  "full-graph": "Full-graph",
};

export const DISPATCH_MODE_DESCRIPTIONS: Record<DispatchMode, string> = {
  "one-to-one": "Delegate to one sub-agent, Manager decides next after completion",
  "chain": "Multiple sub-agents relay sequentially, previous output feeds next",
  "full-graph": "Fully connected graph, Manager dynamically decides each step",
};

// ─── Config ─────────────────────────────────────────────────────────

export interface ResonancoConfig {
  defaultPermissionLevel: PermissionLevel;
  contextDecayFactor: number;     // context decay factor (0-1, applied each step)
  contextWeightCap: number;       // max weight value
  userInfluenceBoost: number;     // user interrupt influence weight
  roleFitWeight: number;          // role-fit matching weight
  historyWeight: number;          // history weight
  userInfluenceWeight: number;    // user influence weight
  phaseWeight: number;            // phase weight (reduced, agents decoupled from phases)
  maxConsecutiveSameAgent: number; // max consecutive calls for same agent
  maxParallelTasks: number;
  maxConcurrency: number;
}

export const DEFAULT_CONFIG: ResonancoConfig = {
  defaultPermissionLevel: 2,
  contextDecayFactor: 0.9,
  contextWeightCap: 1.0,
  userInfluenceBoost: 0.3,
  roleFitWeight: 0.45,   // increased: agent capability match is key
  historyWeight: 0.20,
  userInfluenceWeight: 0.25, // user influence
  phaseWeight: 0.10,     // retained as a reference signal only
  maxConsecutiveSameAgent: 3,
  maxParallelTasks: 4,
  maxConcurrency: 2,
};

// ─── Agent Registry Types ──────────────────────────────────────────

export type AgentScope = "user" | "project";

export type CostPriority = "cost" | "speed" | "quality" | "balanced";

export interface AgentConfig {
  name: string;
  description: string;
  tags?: string[];
  tools?: string[];
  model?: string;
  costPriority?: CostPriority;
  maxTurns?: number;
  readonly?: boolean;
  sandbox?: boolean;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}
