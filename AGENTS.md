# AGENTS.md (engine repo)

Rules for any AI coding agent working in this repository. Read `ARCHITECTURE.md` first. The nearest `AGENTS.md` to the file you are editing takes precedence over this one.

## Before you start a task

1. Read your task card in `docs/TASKS.md` (or the linked issue). It names the package, the files you may change, the fixtures that must pass, and "done when".
2. Read the `AGENTS.md` in the package you are changing.
3. Run `pnpm describe-registry` (once it exists) to see which field types, options and widgets exist. Use only those.

## Hard rules

1. **Dependency direction.** `core` imports nothing. `runtime` imports `core`. `renderer` and `editor` import `core` and `runtime`. `theme` imports nothing. Nothing imports the components repo. No `react` in `core` or `runtime`. No deep imports. If your task seems to need an import against these rules, stop and say so in the PR or issue.
2. **The contract is human-owned.** Do not modify `packages/core`, `fixtures/` or `rfcs/` unless your task card explicitly says so. If you need a contract change, open an issue or a draft RFC describing it, and stop. Do not work around the contract with local types, casts or `any`.
3. **Documents are the contract.** Change behavior through entity/view document types and their JSON Schema, then the runtime/renderer. Never special-case behavior inside a component.
4. **No component names or file paths** in `core`, `runtime`, `renderer` or `editor`. Only registry keys.
5. **No escape hatches.** No string expressions, no free-form props bags, no index signatures, no `custom` field types, no `any` in `core` exports.
6. **One package per PR**, plus a changeset. Generated files are the only exception. Cross-package PRs need the `cross-package` label, which only the maintainer applies.
7. **No new packages or new runtime dependencies** without an RFC. Test-only dev dependencies (DOM environments, testing libraries, axe) may be added directly; name them in the PR (DECISIONS.md D16).
8. **Versioning:** any change to `core` schema files bumps `specVersion` and adds a `migrate()` step plus a before/after fixture pair. User document `revision`s are data, not code.
9. **New field type** = JSON Schema entry + registry contract entry + valid and invalid fixtures + render test against the mock registry.
10. **Copied third-party code never lives in this repo.** It belongs in the components repo.

## Working conventions

- Work in your own git worktree on branch `agent/<task-id>`, branched from `main`: `git worktree add .worktrees/<task-id> -b agent/<task-id> main`. Worktrees live only under `.worktrees/` (gitignored); never create folders outside the repo. Do not use `git stash` across worktrees.
- Tools that scan the tree (ESLint, Vitest, dependency-cruiser) must exclude `.worktrees/`.
- Use the memory data adapter and a random dev-server port. Never point at a shared Supabase instance.
- Rebase onto `main` before requesting review.
- Keep PRs small. If a task grows past its card, stop and propose a split.
- **Personal and work-specific notes go in `*.private.md` files** (gitignored, never committed), e.g. `docs/OPEN_QUESTIONS.private.md`. This covers employer or work-app names, clients, sign-off questions, and anything personal. Tracked files describe these generically (e.g. "intake form") and must not quote or summarize `*.private.md` content.

## Commit messages

[Angular format](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md), enforced by `.githooks/commit-msg` (enabled by `git config core.hooksPath .githooks`; the root `prepare` script sets it).

- Header: `<type>(<scope>): <summary>`, max 100 chars. Summary is imperative, lowercase, no trailing period.
- Types: `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `test`. Reverts: `revert: <reverted header>` with `This reverts commit <SHA>` in the body.
- Scopes (optional): the package name (`core`, `runtime`, `renderer`, `editor`, `theme`, `testing`), or `fixtures`, `showcase`, `examples`, `rfcs`, `dev-infra`, `deps`. Omit the scope for repo-wide changes.
- Body: required except for `docs`, at least 20 characters, explains *why*. Trailers such as `Co-Authored-By:` do not count as body.
- Commit early and often: one logical step per commit.

## CI gates (all must pass)

typecheck → dependency-cruiser → unit tests + fixture validation → size-limit → API report diff → changeset present.

## When in doubt

Stop and ask in the PR or issue. A paused task is cheaper than a contract that drifts.
