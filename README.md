# Resonanco

Multi-agent orchestration framework for pi. Manager analyzes requests and delegates to specialized sub-agents.

## Quick Start

### Install

```bash
ln -sf "$(pwd)" ~/.pi/agent/extensions/resonanco
```

Then `/reload` in pi.

### Commands

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
| `/resonanco:implement <task>` | Implementation pipeline |
| `/resonanco:review <content>` | Code review |
| `/resonanco:explore <topic>` | Research exploration |
| `/resonanco:debate <topic>` | Multi-perspective analysis |
| `/resonanco:supervise <task>` | Step-by-step supervised execution |

### Shortcuts

| Shortcut | Function |
|----------|----------|
| `ctrl+shift+r` | Cycle permission Lv1->Lv4 |
| `ctrl+shift+m` | Toggle auto Manager mode |
| `ctrl+q` | Toggle plan/build mode |

## How It Works

### Dispatch Modes

| Mode | Pattern | Use Case |
|------|---------|----------|
| `one-to-one` | Single agent → re-decide | Simple/single tasks |
| `chain` | Sequential relay with `{previous}` | Multi-step with dependencies |
| `full-graph` | All agents in parallel | Independent sub-tasks |

### Work Modes

| Mode | Tool Access | Use Case |
|------|-------------|----------|
| **BUILD** | All tools | Full development, subject to permission level |
| **PLAN** | read/grep/find/ls/write only | Architecture planning, design docs |

### Permission Levels

| Level | Name | Behavior |
|-------|------|----------|
| Lv1 | Observer | Confirm every step |
| Lv2 | Cautious | Confirm writes only |
| Lv3 | Semi-auto | Confirm dangerous ops only |
| Lv4 | Full-auto | No confirmation |

## Architecture

```
resonanco/
├── src/
│   ├── index.ts           # Extension entry point
│   ├── core/
│   │   ├── engine.ts      # Core orchestration engine
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
├── agents/                # Agent definitions (.md)
├── prompts/               # Workflow prompt templates
├── skills/                # Pi skills
├── test/                  # Tests
└── examples/              # Usage examples
```

## Sub-agents

| Agent | Tools | Role |
|-------|-------|------|
| coder | read, write, edit, bash, grep, find, ls | Implementation |
| reviewer | read, grep, find, ls, bash | Code review, security |
| architect | read, grep, find, ls | Solution design |
| tester | read, write, edit, bash, grep, find, ls | Testing |
| documenter | read, write, edit, grep, find, ls | Documentation |
| devops | read, write, edit, bash, grep, find, ls | Infrastructure |
| researcher | read, grep, find, ls, bash | Research |

## License

MIT
