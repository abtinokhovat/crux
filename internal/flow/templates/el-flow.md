---
crux: flow
id: {{id}}
{{in}}summary: <one line>
trigger: <what starts it>
outcome: <the end state when it succeeds>
# decided_by: [12]
---
# {{title}}

```steps
// one hop per line; ids before ":" name the steps. Remove the // to use these.
// == phase ==
// start: customer -> api : http POST /things
// next:  api --> worker : topic thing.created
//   ? it fails -> end
```
