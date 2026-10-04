# crux

**Decisions your team and your agents can see.** Architecture Decision Records stay plain markdown
in your repo. crux turns them into a connected, visual app, runs the decision flow with your team,
and lets every coding agent check what was decided before it changes code.

```
capture ──▶ enrich ──▶ shape ──▶ review ──▶ finalize ──▶ agents use it
  you      your Claude    you       team        you       every agent
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/abtinokhovat/crux/main/install.sh | sh
```

One binary for macOS and Linux (amd64/arm64). Windows: download the zip from
[Releases](https://github.com/abtinokhovat/crux/releases). With Go: `go install github.com/abtinokhovat/crux/cmd/crux@latest`.

Then in your project:

```bash
crux init            # crux.config.yaml, docs/adr/, architecture map, template
crux skill install   # the agent skills → .claude/skills/ (see below for other harnesses)
crux serve --open    # the app, live-reloading as files change
```

### Skills for your coding agent

The `crux` and `answer-me-with-html` skills follow the SKILL.md format, so any harness that reads
project skills can use them. Pick yours:

| Harness | Install | Lands in |
|---|---|---|
| Claude Code | `crux skill install` — or as a plugin: `/plugin marketplace add abtinokhovat/crux` then `/plugin install crux@crux` | `.claude/skills/` |
| Codex | `crux skill install --agent codex` | `.agents/skills/` |
| Cursor | `crux skill install --agent cursor` | `.cursor/skills/` |
| Gemini CLI | `crux skill install --agent gemini` | `.gemini/skills/` |
| GitHub Copilot | `crux skill install --agent copilot` | `.github/skills/` |
| OpenCode | `crux skill install --agent opencode` | `.opencode/skills/` |

Several at once: `--agent claude,codex`, or `--agent all`. Existing skills are kept unless you pass `--force`.

## The flow

1. **Capture** — `crux q "Which broker do we use for v1?"` or **＋ Question** in the app. A private Draft.
   In a meeting: `crux q "…" --notes` — the room gets a link, sees only the question, adds notes.
2. **Enrich** — in Claude Code: `/crux enrich 20`. Your Claude researches the code and other ADRs and
   writes options, scenarios, questions for people, and the links (relates / depends on / supersedes,
   tags, components, `applies_to`). Its blocks show as “from your Claude” with **Keep / Drop**.
3. **Shape** — edit, set your leaning, write `- @handle: question` lines. Still private.
4. **Review** — `crux share 20` or **Share for review**. Teammates pick an option with confidence,
   add pros and cons (a reason is required), answer questions for them, comment. You see it live on the
   ADR page and reply. `crux pull 20` + `/crux digest 20` lets your Claude summarize it.
5. **Finalize** — the Finalize panel or `crux finalize 20 --option C --decision "…" --reopen "…"`:
   decision, verdicts, dissent from differing picks, reopen triggers, status Accepted. Reviewers see
   the decision. **You commit** — crux never touches git.
6. **Agents use it** — `crux context services/inbox kafka` tells any agent what is decided, what was
   rejected and why, and when to reopen. The skill makes Claude check it before changing code.

Your Claude is personal: it works on your files and never posts to the team.

## What you see

- **Overview** — a blueprint sheet: what needs a decision, the decision register, an architecture tree,
  status per area, history, tags.
- **ADR pages** — the decision as a bold banner, options as cards (chosen / leaning / rejected),
  scenario grids, consequences in columns, linked ADRs with hover previews, the flow strip and sharing.
- **Architecture map** — zoom from the platform into an area (Message broker → Kafka) down to its ADRs.
  Straight arrows, boxes you can pin with `x/y`, outside neighbours as dashed ghosts.
- **Graph, tags, ⌘K search.**
- **Components** — fenced blocks: `decision`, `options`, `compare`, `scenarios`, `proscons`, `tradeoff`,
  `stats`, `adr`, plus diagrams (`flow`, `sequence`, `tree`, `timeline`, `limits`, `kv`, `callout`,
  `annot`) and syntax highlighting for any code fence. Add your own in `.crux/components/*.mjs`.

## Share server

A small service for meeting notes and team review. Deploy it once:

```bash
docker run -d -p 8080:8080 -v crux-data:/data \
  -e CRUX_TOKENS="abtinokhovat:$(openssl rand -hex 24)" \
  -e CRUX_PASSCODE="team-secret" \
  -e CRUX_PUBLIC_URL="https://crux.example.com" \
  ghcr.io/abtinokhovat/crux:latest
```

[`deploy/docker-compose.yml`](deploy/docker-compose.yml) adds Caddy for HTTPS on your domain. Without
Docker: `CRUX_TOKENS=… crux server --port 8080`.

- **Owners** (who publish) have tokens in `CRUX_TOKENS` (`handle:token`, comma-separated).
- **Teammates** enter `CRUX_PASSCODE` once per browser, plus their git handle — no accounts.
- Data: one JSON file per question in `/data`.

On your laptop: `crux login https://crux.example.com --token <token>`, and in `crux.config.yaml`:
`share: https://crux.example.com`. Share links and pulled reviews stay in `.crux/` (git-ignored).

## Commands

| | |
|---|---|
| `crux serve [--port] [--open]` · `crux build [-o dir]` | App with live reload · static export |
| `crux q <question> [--notes] [-c notes] [--due D]` | Capture a private Draft |
| `crux notes <id> [--close\|--import]` · `crux share <id> [--close]` | Notes from the room · team review |
| `crux pull <id>` · `crux finalize <id> --option X …` | Team input for your Claude · accept |
| `crux link <a> <rel> <b>` · `crux context [paths…] [terms…]` | Links both sides · decisions for agents |
| `crux list · show · search · lint · index · graph · tags · components · next` | Everyday tools (`--json` for scripts) |
| `crux init · new · skill install · server · login · me` | Setup and the share server |

## Writing ADRs

ADRs are `docs/adr/NNNN-slug.md` with frontmatter (`status`, `tags`, `components`, `applies_to`,
`reopen_when`, `relates`, `depends_on`, `supersedes`, …) and `## Panels`. Panels named **Decision**,
**Question**, **Options** (a table with an `ok/warn/no` verdict column), **Scenarios**,
**Recommendation**, **Consequences**, **Questions for the team** get visual treatment. The skill
([`skills/crux/SKILL.md`](skills/crux/SKILL.md)) is the full guide.

## Develop

```bash
go run ./cmd/crux serve --root example      # backend: Go (cmd/, internal/)
npm install && npm run build:web            # renderer: web-src/ → web/vendor/crux-render.js (committed)
```

The browser renders ADRs with the bundled [answer-me-with-html](skills/answer-me-with-html) renderer,
so the local app and the share page look the same. Releases: push a `v*` tag — GoReleaser publishes
binaries and the share-server image.

```
cmd/crux/            entry point
internal/adr         parse markdown (frontmatter, panels, options, facts) and build the index
internal/edit        safe line-based markdown edits
internal/flow        capture, link, import notes, finalize, context (+ templates/)
internal/share       share server, its page (assets/), and the client
internal/app         local app server, live reload, actions, static build
internal/cli         commands (+ help.txt)
web/                 the app (vanilla JS, embedded); web/vendor/crux-render.js is generated
web-src/             renderer sources · skills/ Claude skills · example/ demo project
```
