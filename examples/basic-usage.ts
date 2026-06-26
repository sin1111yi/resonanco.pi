/**
 * Resonanco — Basic Usage Examples
 *
 * Demonstrates how to use the resonanco tool and commands from pi.
 * Copy-paste these prompts into your pi session.
 */

// ─── 1. One-to-One: Single Agent ──────────────────────────────────
//
// Delegate to a single sub-agent, then Manager re-decides.
//
// User prompt:
//   Use resonanco: delegate to researcher to find all API routes
//   in this project and report the file paths.
//

// ─── 2. Chain: Sequential Relay ───────────────────────────────────
//
// Multiple sub-agents execute in sequence. Use {previous} to
// reference the previous agent's output.
//
// User prompt:
//   Use resonanco chain: coder implements a hello.js in the
//   current directory, then tester verifies it runs.
//

// ─── 3. Full-Graph: Parallel Execution ────────────────────────────
//
// Multiple sub-agents run simultaneously. All their braille dots
// spin at once. Manager analyzes all results after.
//
// User prompt:
//   Use resonanco full-graph: coder counts lines in index.ts,
//   researcher counts function definitions, both in parallel.
//

// ─── 4. Multi-Round: Parallel then Synthesize ─────────────────────
//
// Round 1 (full-graph): multiple agents explore independently.
// Round 2 (one-to-one): documenter synthesizes all findings.
//
// User prompt:
//   Round 1: Use full-graph — coder finds all .ts files, researcher
//   counts total lines of code.
//   Round 2: After both complete, delegate documenter to write
//   a summary report combining both results.
//

// ─── 5. Supervised: Lv1 Step-by-Step ──────────────────────────────
//
// Every step requires user confirmation before execution.
// Use /resonanco:approve to confirm, /resonanco:reject to reject.
//
// User prompt:
//   /resonanco:supervise Refactor the auth module to use JWT
//
// Or set permission directly:
//   /resonanco:permission 1
//   Use resonanco to refactor the auth module to use JWT
//

// ─── Commands ─────────────────────────────────────────────────────
//
// /resonanco:status           View engine status
// /resonanco:agents           List all available agents
// /resonanco:permission <1-4> Set permission level
// /resonanco:widget [off]     Toggle widget display
// /resonanco:approve          Confirm Manager's plan
// /resonanco:reject <reason>  Reject with feedback
// /resonanco:auto [on|off]    Toggle auto Manager mode
//
// Workflow shortcuts:
// /resonanco:implement <task>  Full implementation pipeline
// /resonanco:review <content>  Code review
// /resonanco:explore <topic>   Research exploration
// /resonanco:debate <topic>    Multi-perspective analysis
// /resonanco:supervise <task>  Step-by-step supervised execution
//

// ─── Shortcuts ────────────────────────────────────────────────────
//
// ctrl+shift+r    Cycle permission Lv1->Lv4
// ctrl+shift+m    Toggle auto Manager mode
// ctrl+q          Toggle plan/build mode
//

// ─── Work Modes ───────────────────────────────────────────────────
//
// Plan mode:  Read-only + design docs. Blocks code modification and
//             bash commands. Use for architecture planning, research,
//             and writing design documents.
// Build mode: Full access to all tools, subject to permission level.
//
// /resonanco:mode [plan|build]  Set work mode
// ctrl+shift+p                  Toggle between plan/build
//
