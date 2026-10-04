---
title: {{prefix}}-{{id}} — {{title}}
subtitle: <one line: what we decided>
status: {{status}}
date: {{date}}
author: {{author}}
tags: [{{tags}}]
components: [{{components}}]
# supersedes: [0003]
# depends_on: [0001]
# relates: [0005]
---

## Decision {span=3}
```callout ok Decision
<What we will do, in 1–3 sentences. Active voice.>
```

## Context {span=3}
- <Forces at play: requirements, constraints, what triggered this. Facts, not opinions.>

## Options {span=3}
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A — <chosen> | … | … | ok |
| B — <alternative> | … | … | no |

## Comparison {span=3}
```compare
Criterion | weight | A | B
<criterion 1> | 3 | 4 | 2
<criterion 2> | 2 | 3 | 5
```

## Design {span=3}
```flow LR
Client -> Service: HTTP
Service -> [(DB)]
```

## Consequences {span=3}
- Positive: …
- Cost we accept: …
- Follow-ups: …
