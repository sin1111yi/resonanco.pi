/**
 * Resonanco — Agent Registry: discover, cache, and query agent definitions
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig, AgentDiscoveryResult, AgentScope } from "../types/index.ts";

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
  const agents: AgentConfig[] = [];
  if (!fs.existsSync(dir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    const tags = frontmatter.tags
      ?.split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);

    const maxTurns = frontmatter["max-turns"]
      ? parseInt(frontmatter["max-turns"], 10)
      : undefined;

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tags: tags?.length ? tags : undefined,
      tools: tools?.length ? tools : undefined,
      model: frontmatter.model,
      costPriority: frontmatter["cost-priority"] as AgentConfig["costPriority"],
      maxTurns: maxTurns && !isNaN(maxTurns) ? maxTurns : undefined,
      readonly: frontmatter.readonly === "true",
      sandbox: frontmatter.sandbox === "true",
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // not found
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function findResonancoAgentsDir(): string | null {
  const agentDir = getAgentDir();
  const candidate = path.join(agentDir, "resonanco", "agents");
  try {
    if (fs.statSync(candidate).isDirectory()) return candidate;
  } catch {
    // not found
  }
  return null;
}

/**
 * Discover all agent definitions from configured locations.
 */
export function discoverAgents(
  cwd: string,
  scope: AgentScope,
): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  const resonancoDir = findResonancoAgentsDir();

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || !projectAgentsDir
      ? []
      : loadAgentsFromDir(projectAgentsDir, "project");
  const resonancoAgents = resonancoDir
    ? loadAgentsFromDir(resonancoDir, "user")
    : [];

  // Deduplicate by name: project > user > resonanco
  const agentMap = new Map<string, AgentConfig>();
  for (const agent of resonancoAgents) agentMap.set(agent.name, agent);
  for (const agent of userAgents) agentMap.set(agent.name, agent);
  for (const agent of projectAgents) agentMap.set(agent.name, agent);

  // Filter by scope
  const filtered: AgentConfig[] = [];
  for (const agent of agentMap.values()) {
    if (scope === "project" && agent.source !== "project") continue;
    if (scope === "user" && agent.source === "project") continue;
    filtered.push(agent);
  }

  return { agents: filtered, projectAgentsDir };
}

/**
 * Format agent list for tool descriptions.
 */
export function formatAgentList(
  agents: AgentConfig[],
  maxItems: number,
): { text: string; remaining: number } {
  if (agents.length === 0) return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  return {
    text: listed
      .map((a) => `${a.name} (${a.source}): ${a.description}`)
      .join("; "),
    remaining: agents.length - listed.length,
  };
}

/**
 * Find agents by tag.
 */
export function findAgentsByTag(
  agents: AgentConfig[],
  tag: string,
): AgentConfig[] {
  return agents.filter((a) => a.tags?.includes(tag));
}

/**
 * Find a single agent by name.
 */
export function findAgentByName(
  agents: AgentConfig[],
  name: string,
): AgentConfig | undefined {
  return agents.find((a) => a.name === name);
}
