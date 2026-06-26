---
description: Full implementation workflow - scout gathers context, planner creates plan, worker implements
workflow: chain
---
Use the resonanco tool with chain pattern:

1. First, use the "scout" agent to gather context about: $@
2. Then, use the "planner" agent to create an implementation plan using the scout's output ({previous})
3. Finally, use the "worker" agent to implement the plan ({previous})

Execute as a chain, passing output between steps via {previous}.
