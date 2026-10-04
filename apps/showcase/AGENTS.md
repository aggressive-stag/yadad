# AGENTS.md (showcase)

App rules on top of the root `AGENTS.md`. Private, never published.

- **Role:** a host app. It builds a `Registry` and a `DataAdapter` and injects them into the renderer and editor. This is the only kind of place dependency injection happens.
- **Imports:** renderer, editor, theme and testing (for the mock registry). Components from the components repo come in only as an injected registry.
- **Dev:** use the memory adapter and a random dev-server port. Never point at a shared Supabase instance.
- **Commit scope:** `showcase`.
