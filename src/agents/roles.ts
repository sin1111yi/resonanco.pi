/**
 * Resonanco — Role definitions and capability matrices
 *
 * Agent role capability profiles, function matching tables, and phase reference tables.
 * Used by the Relay decider.
 */

import type { AgentRole, WorkPhase } from "../types/index.ts";

// ─── Role-Fit Matrix ───────────────────────────────────────────────
// Values 0.0-1.0, representing how well an agent matches the current need

export type DemandType =
  | "write_code"
  | "review_quality"
  | "design_solution"
  | "test_verify"
  | "write_docs"
  | "deploy_infra"
  | "research_investigate"
  | "general_analysis";

const ROLE_FIT_MATRIX: Record<DemandType, Record<AgentRole, number>> = {
  write_code: {
    coder: 1.0, reviewer: 0.2, architect: 0.3,
    manager: 0.0, tester: 0.2, documenter: 0.1, devops: 0.3, researcher: 0.2,
  },
  review_quality: {
    coder: 0.2, reviewer: 1.0, architect: 0.4,
    manager: 0.0, tester: 0.4, documenter: 0.3, devops: 0.2, researcher: 0.2,
  },
  design_solution: {
    coder: 0.3, reviewer: 0.3, architect: 1.0,
    manager: 0.0, tester: 0.2, documenter: 0.1, devops: 0.4, researcher: 0.4,
  },
  test_verify: {
    coder: 0.2, reviewer: 0.3, architect: 0.2,
    manager: 0.0, tester: 1.0, documenter: 0.1, devops: 0.4, researcher: 0.2,
  },
  write_docs: {
    coder: 0.3, reviewer: 0.2, architect: 0.2,
    manager: 0.0, tester: 0.1, documenter: 1.0, devops: 0.2, researcher: 0.3,
  },
  deploy_infra: {
    coder: 0.2, reviewer: 0.2, architect: 0.3,
    manager: 0.0, tester: 0.2, documenter: 0.2, devops: 1.0, researcher: 0.2,
  },
  research_investigate: {
    coder: 0.3, reviewer: 0.2, architect: 0.5,
    manager: 0.0, tester: 0.2, documenter: 0.3, devops: 0.2, researcher: 1.0,
  },
  general_analysis: {
    coder: 0.5, reviewer: 0.6, architect: 0.8,
    manager: 0.1, tester: 0.5, documenter: 0.3, devops: 0.3, researcher: 0.7,
  },
};

export function getRoleFit(demand: DemandType, role: AgentRole): number {
  return ROLE_FIT_MATRIX[demand]?.[role] ?? 0;
}

export function getAllRoleFits(demand: DemandType): Record<AgentRole, number> {
  return { ...ROLE_FIT_MATRIX[demand] };
}

// ─── Phase-Fit Matrix ──────────────────────────────────────────────
// Current phase is a weak signal; does not exclude any agent

const PHASE_FIT_MATRIX: Record<WorkPhase, Record<AgentRole, number>> = {
  reception: {
    coder: 0.2, reviewer: 0.2, architect: 0.6,
    manager: 0.0, tester: 0.1, documenter: 0.2, devops: 0.1, researcher: 0.6,
  },
  reconnaissance: {
    coder: 0.3, reviewer: 0.1, architect: 0.5,
    manager: 0.0, tester: 0.2, documenter: 0.2, devops: 0.2, researcher: 0.9,
  },
  planning: {
    coder: 0.2, reviewer: 0.2, architect: 1.0,
    manager: 0.0, tester: 0.1, documenter: 0.1, devops: 0.3, researcher: 0.3,
  },
  execution: {
    coder: 1.0, reviewer: 0.2, architect: 0.3,
    manager: 0.0, tester: 0.3, documenter: 0.2, devops: 0.5, researcher: 0.2,
  },
  quality: {
    coder: 0.2, reviewer: 1.0, architect: 0.2,
    manager: 0.0, tester: 0.8, documenter: 0.6, devops: 0.2, researcher: 0.2,
  },
};

export function getPhaseFit(phase: WorkPhase, role: AgentRole): number {
  return PHASE_FIT_MATRIX[phase]?.[role] ?? 0;
}

export function getAllPhaseFits(phase: WorkPhase): Record<AgentRole, number> {
  return { ...PHASE_FIT_MATRIX[phase] };
}

// ─── Demand Classification ─────────────────────────────────────────
// Infer need type from task description

export function classifyDemand(task: string): DemandType {
  const lower = task.toLowerCase();

  const patterns: Array<[RegExp, DemandType]> = [
    [/implement|write|code|refactor|add feature|create|modify|update/, "write_code"],
    [/review|audit|check|inspect|quality|security|bug|issue/, "review_quality"],
    [/design|architect|plan|schema|structure|decide|choose|option/, "design_solution"],
    [/test|verify|validate|coverage|assert|spec/, "test_verify"],
    [/document|readme|doc|api docs|changelog|comment|guide/, "write_docs"],
    [/deploy|ci|cd|docker|container|pipeline|infra|config|release/, "deploy_infra"],
    [/research|investigate|explore|find|analyze|understand|learn|trace/, "research_investigate"],
    [/assess|evaluate|overview|summary|compare/, "general_analysis"],
  ];

  for (const [regex, demand] of patterns) {
    if (regex.test(lower)) return demand;
  }

  return "general_analysis";
}

// ─── Agent Capability Descriptions ─────────────────────────────────

export const ROLE_CAPABILITIES: Record<AgentRole, string> = {
  coder: "Implementation: Write code、Refactoring、Fix bugs、Implement features",
  reviewer: "Quality review: code review, security, quality, compliance",
  architect: "Design: tech selection, architecture decisions, modular design",
  manager: "Central decision-making: task dispatch, output analysis, user dialogue, direction",
  tester: "Testing: write tests, run tests, verify, regression",
  documenter: "Documentation: README, API docs, CHANGELOG, user guides",
  devops: "Infrastructure: CI/CD, Docker, deployment, environment",
  researcher: "Investigation: code exploration, technical research, root cause analysis",
};
