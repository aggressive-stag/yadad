# Build Plan (historical)

This file planned the build in phases (0: guardrails + walking skeleton, 1: contract design, 2–5: forms, tables, dashboard, editor, 6: hardening), with real apps as exit criteria and a parallelization map for agents. The phases are done, and the process it described — one package per PR, CODEOWNERS review gates, merging one PR at a time — no longer runs. Today agents take task cards from the owner, work in worktrees under `.worktrees/`, and land and release their own work straight to `main` (see `AGENTS.md`).

The parts that still hold live in `ARCHITECTURE.md`: the two-repo split, the dependency direction, fixture-driven tests, and "real apps are the test." The rest — the phase table, the `contract-v0` gate, the parallelization map, the risk table — is history; don't follow it.
