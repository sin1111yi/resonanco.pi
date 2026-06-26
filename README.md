# Resonanco

Multi-agent orchestration framework for [pi](https://github.com/earendil-works/pi). The **Manager** analyzes requests and delegates to specialized sub-agents — coder, reviewer, architect, tester, documenter, devops, researcher — via configurable dispatch modes.

## Install

```bash
# From GitHub (recommended)
pi install git:github.com/sin1111yi/resonanco.pi

# From npm
pi install resonanco.pi

# Manual symlink for development
ln -sf "$(pwd)" ~/.pi/agent/extensions/resonanco
```

Then `/reload` in pi.

## Quick Start

```bash
/resonanco:auto on          # Enable auto-Manager mode
/resonanco:implement        # Implement a feature
```

Or use the `resonanco` tool directly:

```
Use resonanco to review the auth module
```

## Commands

| Command | Description |
|---------|-------------|
| `/resonanco:status` | View engine status |
| `/resonanco:agents` | List all available agents |
| `/resonanco:permission <1-4>` | Set permission level |
| `/resonanco:widget [off]` | Toggle TUI widget |
| `/resonanco:approve` | Confirm Manager's plan |
| `/resonanco:reject <reason>` | Reject with feedback |
| `/resonanco:auto [on\|off]` | Toggle auto Manager mode |
| `/resonanco:mode [plan\|build]` | Set work mode |
| `/resonanco:register-agent <name> <description>` | Register a custom sub-agent |
| `/resonanco:unregister-agent <name>` | Remove a custom sub-agent |
| `/resonanco:implement <task>` | Implementation pipeline |
| `/resonanco:review <content>` | Code review |
| `/resonanco:explore <topic>` | Research exploration |
| `/resonanco:debate <topic>` | Multi-perspective analysis |
| `/resonanco:supervise <task>` | Step-by-step supervised execution |

## Shortcuts

| Shortcut | Function |
|----------|----------|
| `ctrl+shift+r` | Cycle permission Lv1→Lv4 |
| `ctrl+shift+m` | Toggle auto Manager mode |
| `ctrl+q` | Toggle plan/build mode |

## How It Works

### Dispatch Modes

| Mode | Pattern | Use Case |
|------|---------|----------|
| `one-to-one` | Single agent → re-decide | Simple tasks |
| `chain` | Sequential relay (`{previous}`) | Multi-step with dependencies |
| `full-graph` | All agents in parallel | Independent sub-tasks |

### Work Modes

| Mode | Tool Access | Use Case |
|------|-------------|----------|
| **BUILD** | All tools | Full development, permission-gated |
| **PLAN** | read/grep/find/ls/write only | Architecture planning, design docs |

### Permission Levels

| Level | Name | Behavior |
|-------|------|----------|
| Lv1 | Observer | Confirm every step |
| Lv2 | Cautious | Confirm writes only |
| Lv3 | Semi-auto | Confirm dangerous ops only |
| Lv4 | Full-auto | No confirmation |

### Custom Agents

Register your own sub-agents:

```bash
/resonanco:register-agent security "Security auditor — analyzes code for vulnerabilities"
```

This creates an agent file from `docs/agent-template.md`, registers it with the engine, adds a braille dot to the TUI widget, and asks the Manager to refine its definition.

## Architecture

```
resonanco/
├── src/
│   ├── index.ts           # Extension entry point
│   ├── core/
│   │   ├── engine.ts      # Orchestration engine
│   │   ├── runner.ts      # Sub-agent runner
│   │   ├── permissions.ts # Permission guard
│   │   └── relay.ts       # Relay decision logic
│   ├── agents/
│   │   ├── registry.ts    # Agent discovery
│   │   └── roles.ts       # Role definitions
│   ├── context/
│   │   └── pool.ts        # Weighted context pool
│   ├── observer/
│   │   └── protocol.ts    # User interaction protocol
│   ├── ui/
│   │   └── renderer.ts    # TUI rendering
│   └── types/
│       └── index.ts       # Shared types
├── agents/                # Built-in agent definitions
├── prompts/               # Workflow prompt templates
├── skills/                # Manager skill
├── docs/                  # Templates and documentation
└── test/                  # Tests
```

## Built-in Sub-agents

| Agent | Tools | Role |
|-------|-------|------|
| coder | read, write, edit, bash, grep, find, ls | Implementation |
| reviewer | read, grep, find, ls, bash | Code review, security |
| architect | read, grep, find, ls | Solution design |
| tester | read, write, edit, bash, grep, find, ls | Testing |
| documenter | read, write, edit, grep, find, ls | Documentation |
| devops | read, write, edit, bash, grep, find, ls | Infrastructure |
| researcher | read, grep, find, ls, bash | Research |

## Widget

The TUI widget shows real-time status:

```
BUILD • ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ • step 3 • OneToOne • ◈ coder • 💤 Observer • 📋 ctx:5 • [auto]
```

- Braille dots: one per agent, spinning when active, ⣶ when idle
- Step count, dispatch mode, current agent
- Permission level and work mode
- Context pool entry count

## License

MIT
