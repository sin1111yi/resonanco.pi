/**
 * Resonanco — Permission Guard
 *
 * 4-level permission management controlling agent autonomy.
 * Supports global level and per-agent override.
 */

import type { AgentRole, PermissionLevel } from "../types/index.ts";
import {
  PERMISSION_CONFIRM_READ,
  PERMISSION_CONFIRM_WRITE,
  PERMISSION_CONFIRM_DANGEROUS,
} from "../types/index.ts";

export type OperationType = "read" | "write" | "dangerous" | "relay_decision";

export interface PermissionCheckResult {
  allowed: boolean;
  requiresConfirm: boolean;
  reason?: string;
}

export class PermissionGuard {
  private globalLevel: PermissionLevel;
  private agentOverrides = new Map<AgentRole, PermissionLevel>();

  constructor(level: PermissionLevel = 2) {
    this.globalLevel = level;
  }

  /** Get effective permission level for an agent */
  getEffectiveLevel(role: AgentRole): PermissionLevel {
    return this.agentOverrides.get(role) ?? this.globalLevel;
  }

  /** Set global level */
  setGlobalLevel(level: PermissionLevel): void {
    this.globalLevel = level;
  }

  /** Get global level */
  getGlobalLevel(): PermissionLevel {
    return this.globalLevel;
  }

  /** Set level for a specific agent */
  setAgentLevel(role: AgentRole, level: PermissionLevel): void {
    this.agentOverrides.set(role, level);
  }

  /** Reset agent to global level */
  resetAgentLevel(role: AgentRole): void {
    this.agentOverrides.delete(role);
  }

  /** Check if operation needs confirmation */
  checkOperation(role: AgentRole, operation: OperationType, detail?: string): PermissionCheckResult {
    const level = this.getEffectiveLevel(role);

    switch (operation) {
      case "read":
        return {
          allowed: true,
          requiresConfirm: PERMISSION_CONFIRM_READ[level],
          reason: PERMISSION_CONFIRM_READ[level]
            ? `[Lv${level}] Read needs confirm: ${detail ?? ""}`
            : undefined,
        };

      case "write":
        return {
          allowed: true,
          requiresConfirm: PERMISSION_CONFIRM_WRITE[level],
          reason: PERMISSION_CONFIRM_WRITE[level]
            ? `[Lv${level}] Write needs confirm: ${detail ?? ""}`
            : undefined,
        };

      case "dangerous":
        return {
          allowed: true,
          requiresConfirm: PERMISSION_CONFIRM_DANGEROUS[level],
          reason: PERMISSION_CONFIRM_DANGEROUS[level]
            ? `[Lv${level}] Dangerous needs confirm: ${detail ?? ""}`
            : undefined,
        };

      case "relay_decision":
        return {
          allowed: true,
          requiresConfirm: level === 1,
          reason: level === 1
            ? `[Lv1] Relay decision requires user confirmation`
            : undefined,
        };

      default:
        return { allowed: true, requiresConfirm: false };
    }
  }

  /** Check if operation is dangerous */
  static isDangerous(commandOrPath: string): boolean {
    const dangerousPatterns = [
      /rm\s+-rf/i,
      /sudo\s+/i,
      /del(ete)?\s+/i,
      /DROP\s+TABLE/i,
      /TRUNCATE\s+/i,
      /chmod\s+777/i,
      /npm\s+(un)?publish/i,
      /docker\s+rm/i,
      /format/i,
      /mkfs/i,
      />\s*\/dev\//,
      /dd\s+if=/,
    ];
    return dangerousPatterns.some((p) => p.test(commandOrPath));
  }

  /** Check if operation is a write */
  static isWriteOperation(toolName: string): boolean {
    return ["write", "edit", "write_file", "create_file"].includes(toolName);
  }

  /** Get config summary */
  getConfigSummary(): string {
    const parts: string[] = [`Global: Lv${this.globalLevel}`];
    for (const [role, level] of this.agentOverrides) {
      parts.push(`${role}: Lv${level}`);
    }
    return parts.join(" | ");
  }
}
