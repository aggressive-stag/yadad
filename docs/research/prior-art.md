# Prior Art

Reference only. Nothing here is a dependency of the engine unless `ARCHITECTURE.md` §9 says so. Checked October 4, 2026.

## Who already does this

Runtime schema-driven UI engines already exist. The project's value is learning, ownership and fit, not being first. The README must name these projects and say what this one does differently.

| Project | What it is | Overlap | Difference / verdict |
| --- | --- | --- | --- |
| [Object UI](https://github.com/objectstack-ai/objectui) | MIT schema-driven React renderer from ObjectStack; agents write JSON, it renders grids, kanban, dashboards, forms | Very high: registry, shadcn + Tailwind components, `DataSource` interface, schema/data separation, AI-first | **Read it, do not build on it.** See evaluation below. |
| [amis](https://github.com/baidu/amis) (Baidu) | Apache 2.0 low-code framework; JSON config generates admin pages | High: JSON pages, CRUD, forms, API calls in schema, visual editor | Mature (~18.9k stars, ~9.9k npm downloads/week) but brings its own component set; Chinese-first docs; last npm publish Jan 2026. Avoid its string expressions and API URLs inside schemas. |
| [Formily](https://formilyjs.org) (Alibaba) | Schema-driven form library; framework-agnostic reactive core + React bindings | Registry, core/UI split | Forms only; ~28k downloads/week but no publish since May 2025 (maintenance mode). Avoid its reactive-graph complexity. |
| [Form.io](https://form.io/form-json-schema-vs-submission/) | Form builder/renderer; open-source core, paid platform | Same two-document model: form schema vs submissions; revisions keep old data valid | Forms only. Borrow the two-document model and revisions. |
| [json-render](https://json-render.dev/) (Vercel Labs) | AI generates JSON constrained to a catalog of your components | Catalog = registry; AI-first; forms, tables, dashboards | Aimed at on-the-fly AI UI, not stored user-edited documents. Borrow: generate agent docs from the registry; JSON Patch as the write format. |
| [Puck](https://github.com/puckeditor/puck) | MIT visual page editor for React | Config registers components; editor saves JSON; separate `Render` | Built for content pages, not data-bound pages. Borrow: editor/renderer split, `migrate()` + `transformProps` migration kinds. |
| [react-jsonschema-form](https://rjsf-team.github.io/react-jsonschema-form/) | Forms from JSON Schema | `schema` vs `uiSchema`; fields/widgets/templates registry | Forms only. Borrow the field / widget / template distinction. |
| Appsmith, ToolJet, Budibase ([comparison](https://blog.elest.io/low-code-showdown-tooljet-vs-appsmith-vs-budibase-which-one-fits-your-team/)) | Self-hosted internal tool builders | Same problem space | Whole platforms you deploy, not a library you embed. |

## Object UI evaluation (cloned and inspected Oct 4, 2026)

Real code, poor foundation:

- **Authorship:** about half of 11,380 commits (Jan–Oct 2026) come from bots (`copilot-swe-agent`, `objectstack-fleet[bot]`, `claude[bot]`, `dependabot`) and agent personas on company email addresses ("Warren Buffett", "Steve Jobs", "Sam Altman" @objectstack.ai).
- **Churn:** `@object-ui/core` went from 0.3 (Jan 27) to 7.0 (Jun 22) to 17.x (Jul 31). Breaking-change commits: 14 in Jul, 36 in Aug, 96 in Sep 2026.
- **Coupling:** `@object-ui/types` and `@object-ui/core` depend on `@objectstack/spec`; `@object-ui/react` depends on `@object-ui/data-objectstack`. "Backend-agnostic" is true only at the `DataSource` interface.
- **Size:** 40 packages, ~578k lines of non-test TypeScript, 4,430 test files.
- **Adoption:** 133 npm downloads/week for `@object-ui/react` (Sep 27–Oct 3, 2026); 27 GitHub stars.
- **Ownership model:** imports Radix packages as dependencies rather than owning copies.
- **What works:** the hello-world example is clean (`SchemaRendererProvider` + `SchemaRenderer` + a small JSON page).

Worth reading: its schema types, `DataSource` interface, package split. Use it as a cautionary example for package sprawl and contract churn.

## Pattern sources by piece

| Piece | Study | Take |
| --- | --- | --- |
| Editor/renderer split | Puck | One config drives both editor and renderer; two migration kinds |
| Schema vs layout | RJSF, JSON Forms | Data schema separate from UI schema; declarative visibility rules |
| Headless core | TanStack Table, Formily, JSON Forms, react-grid-layout v2 `src/core`, React Stately | Logic in framework-agnostic TS; thin React bindings |
| Component ownership | [shadcn/ui](https://ui.shadcn.com) | Open code you own and style |
| Accessible primitives | [Radix](https://www.radix-ui.com/primitives), [React Aria](https://react-spectrum.adobe.com/react-aria/) | Depend on these; own the styling |
| Drag and drop | [dnd-kit](https://dndkit.com) (`@dnd-kit/react`, pre-1.0) | Sensors and custom collision; keep behind an adapter |
| Dashboard grid | [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) v2 | `x,y,w,h` layout model; pure-TS core; RFC-driven rewrite with `legacy/` wrapper |
| Two-document model | Form.io | Schema and submissions stored separately; revisions |
| Agent-facing catalog | json-render | Generate prompts/docs from the registry |

Sources: [Object UI](https://github.com/objectstack-ai/objectui), [amis README](https://github.com/baidu/amis/blob/master/README-en.md), [Form.io two-document model](https://form.io/form-json-schema-vs-submission/), [json-render](https://json-render.dev/), [Puck docs](https://puckeditor.com/docs), [Puck on React DnD libraries](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/@object-ui/react).
