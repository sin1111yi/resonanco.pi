/**
 * Resonanco — Observer Protocol
 *
 * Observer Protocol: handle user interrupts, feedback, approvals.
 * Manager communicates bi-directionally with user via this module.
 */

import type { AgentRole, PermissionLevel, WorkPhase } from "../types/index.ts";
import type { ContextPool } from "../context/pool.ts";
import type { PermissionGuard } from "../core/permissions.ts";

export interface UserInterrupt {
  id: string;
  text: string;
  timestamp: number;
  processed: boolean;
  type: "interrupt" | "feedback" | "redirect" | "approve" | "reject" | "permission";
}

export interface DialogueMessage {
  role: "manager" | "user";
  content: string;
  timestamp: number;
}

export interface DialogueSession {
  messages: DialogueMessage[];
  pendingQuestion: string | null; // Manager is waiting for user response
}

export class ObserverProtocol {
  private interrupts: UserInterrupt[] = [];
  private dialogue: DialogueSession = { messages: [], pendingQuestion: null };

  /** Record user interrupt */
  recordInterrupt(text: string, type: UserInterrupt["type"] = "interrupt"): UserInterrupt {
    const entry: UserInterrupt = {
      id: `int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      timestamp: Date.now(),
      processed: false,
      type,
    };
    this.interrupts.push(entry);
    return entry;
  }

  /** Get all unprocessed interrupts */
  getUnprocessedInterrupts(): UserInterrupt[] {
    return this.interrupts.filter((i) => !i.processed);
  }

  /** Mark interrupt as processed */
  markProcessed(id: string): void {
    const entry = this.interrupts.find((i) => i.id === id);
    if (entry) entry.processed = true;
  }

  /** Mark all interrupts as processed */
  markAllProcessed(): void {
    for (const entry of this.interrupts) {
      entry.processed = true;
    }
  }

  /** Get latest unprocessed interrupt text */
  getLatestInterruptText(): string | null {
    const unprocessed = this.getUnprocessedInterrupts();
    if (unprocessed.length === 0) return null;
    return unprocessed[unprocessed.length - 1].text;
  }

  /** Get text summary of all unprocessed interrupts */
  getInterruptSummary(): string {
    const unprocessed = this.getUnprocessedInterrupts();
    if (unprocessed.length === 0) return "";

    return unprocessed
      .map((i) => `[${i.type}] ${i.text}`)
      .join("\n");
  }

  // ─── Dialogue management ────────────────────────────────────────────────

  /** Manager asks user a question */
  managerAsk(question: string): void {
    this.dialogue.messages.push({
      role: "manager",
      content: `**[Confirmation needed]****\n${question}`,
      timestamp: Date.now(),
    });
    this.dialogue.pendingQuestion = question;
  }

  /** Record user answer */
  userRespond(response: string): void {
    this.dialogue.messages.push({
      role: "user",
      content: response,
      timestamp: Date.now(),
    });
    this.dialogue.pendingQuestion = null;
  }

  /** Check if a question is pending */
  hasPendingQuestion(): boolean {
    return this.dialogue.pendingQuestion !== null;
  }

  /** Get pending question */
  getPendingQuestion(): string | null {
    return this.dialogue.pendingQuestion;
  }

  /** Get dialogue history summary */
  getDialogueSummary(): string {
    const recent = this.dialogue.messages.slice(-6); // last 6 messages
    if (recent.length === 0) return "";

    return recent
      .map((m) => {
        const prefix = m.role === "manager" ? "Manager" : "User";
        return `${prefix}: ${m.content}`;
      })
      .join("\n\n");
  }

  // --- Command Processing ---

  /**
   * Process user feedback command, return action
   */
  processCommand(
    command: string,
    pool: ContextPool,
    permission: PermissionGuard,
  ): { action: string; message?: string } {
    const lower = command.trim().toLowerCase();

    // /resonanco:approve
    if (lower.startsWith("/resonanco:approve")) {
      pool.approve();
      return { action: "approve", message: "Output approved" };
    }

    // /resonanco:reject
    if (lower.startsWith("/resonanco:reject")) {
      pool.zeroOut();
      return { action: "reject", message: "Output rejected" };
    }

    // /resonanco:redirect <message>
    if (lower.startsWith("/resonanco:redirect")) {
      const msg = command.slice("/resonanco:redirect".length).trim();
      if (msg) {
        this.recordInterrupt(msg, "redirect");
        return { action: "redirect", message: `Redirect recorded: ${msg}` };
      }
      return { action: "error", message: "Usage: /resonanco:redirect <message>" };
    }

    // /resonanco:feedback <agent> <message>
    if (lower.startsWith("/resonanco:feedback")) {
      const rest = command.slice("/resonanco:feedback".length).trim();
      const parts = rest.split(/\s+/);
      if (parts.length >= 2) {
        const agent = parts[0] as AgentRole;
        const msg = parts.slice(1).join(" ");
        this.recordInterrupt(`Feedback for ${agent}: ${msg}`, "feedback");
        return { action: "feedback", message: `Feedback recorded for ${agent}` };
      }
      return { action: "error", message: "Usage: /resonanco:feedback <agent> <message>" };
    }

    // /resonanco:permission <lv> [agent]
    if (lower.startsWith("/resonanco:permission")) {
      const rest = command.slice("/resonanco:permission".length).trim();
      const parts = rest.split(/\s+/);
      const level = parseInt(parts[0], 10) as PermissionLevel;

      if (level >= 1 && level <= 4) {
        if (parts.length >= 2) {
          const agent = parts[1] as AgentRole;
          permission.setAgentLevel(agent, level);
          return { action: "permission", message: `Permission: ${agent} set to Lv${level}` };
        } else {
          permission.setGlobalLevel(level);
          return { action: "permission", message: `Global permission set to Lv${level}` };
        }
      }
      return { action: "error", message: "Level must be 1-4" };
    }

    // /resonanco:status
    if (lower.startsWith("/resonanco:status")) {
      const stats = pool.getStats();
      return {
        action: "status",
        message: [
          `Context pool: ${stats.total} entries`,
          `Roles: ${Object.entries(stats.byRole).map(([r, c]) => `${r}(${c})`).join(", ")}`,
          `Permission: ${permission.getConfigSummary()}`,
        ].join("\n"),
      };
    }

    // not a command, treat as interrupt
    this.recordInterrupt(command, "interrupt");
    return { action: "interrupt", message: "Recorded" };
  }

  /** Reset */
  reset(): void {
    this.interrupts = [];
    this.dialogue = { messages: [], pendingQuestion: null };
  }
}
