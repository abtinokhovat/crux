---
crux: flow
id: check-before-change
summary: how a coding agent learns what is decided and described before editing code
trigger: an agent is about to change files
outcome: the agent follows accepted decisions and conventions, or stops and asks
decided_by: [4]
---
# Check before change

```steps
ask:     agent -> cli : call crux context
load:    cli -> graph : call Load
read:    graph -> repo : sql markdown files
match:   cli -> workflow : call Context and SystemContext
note: decisions match by applies_to and component code paths; elements by code:, conventions by applies_to
answer:  cli -> agent : call decisions, elements, conventions, open questions
  ? an open question blocks the work -> end
  ? clear -> trace
note: on a blocking question the agent stops and asks the developer instead of guessing
trace:   agent -> cli : call crux trace
```
