---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to an isolated subagent.
---

Delegate deep research to an isolated `subagent` with `agent: "researcher"`, so source-following stays out of the parent context.

Give it a compact task contract: the research question, scope, required primary sources, target Markdown path, and decision the parent needs to make. It must:

1. Investigate against **primary sources** — official docs, source code, specs, first-party APIs — not secondary summaries. Follow each claim to the owning source.
2. Write one detailed cited Markdown brief at the agreed repository path.
3. Return only a compact handoff: brief path, key findings, recommendation, and material gaps.

Keep the parent responsible for the final decision and any code changes. Do not delegate trivial lookups or concurrent writing work.
