# AGENTS.md

This repository designs an environment where Claude Code, Codex, and local LLMs work autonomously, safely, and on structural rules rather than long prompts.

## Rules (all agents)

1. Edit only `docs/*.md` and files named by the current task. Do not edit `index.html` or `viewer/`.
2. Every factual claim in `docs/` cites a primary source as `[^rN]`. Mark inference with `{{opinion}}`.
3. After editing a doc, run `node viewer/lint.js docs/<file>.md`. Fix every warning before finishing.
4. Never read or write secrets (`~/.ssh`, `~/.aws`, tokens, `.env`). Never push, publish, or send data outside this repo.
5. When a rule blocks you, stop and report which rule. Do not work around it.

## Layout

- `docs/` design documents (markdown, rendered by `index.html`)
- `viewer/` markdown parser and UI (read-only for agents)
