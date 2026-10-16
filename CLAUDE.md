# htmlineage

Provenance/lineage layer for AI-generated HTML reports. Every number, chart, and claim traces back to the query that produced it.

## Architecture

**Four-step lineage model:** `source → view → figure → insight`

- **Source** — one wide pinned query per dataset (SQL or external)
- **View** — SELECT over sources/views, shown as tables/charts
- **Figure** — scalar from a view/source or a SQL expression over figures
- **Insight** — claim resting on views/figures/insights

**Three deliverables (MVP):**

1. Skill — LLM instructions so lineage falls out of report building
2. CLI — `npx htmlineage` with commands: `check`, `view`, `sql`
3. Viewer — local two-pane page (report + lineage), served by CLI

**File format:** Plain `.html` with an inert `<script type="application/lineage+json">` block and `data-lineage` attributes on bound elements.

## Key Design Principles

- **Visibility, not verification.** Show lineage; don't claim correctness.
- **Ledger, not cage.** Record provenance; don't constrain the model's computation.
- **Builder friction = zero.** The business user should not notice the tool. Reports look identical with or without lineage.
- **Pinned time.** All queries use absolute date ranges, never `current_date`/`now()`.
- **SQL-first evidence.** The composed script ("copy report as SQL") is the primary review artifact.

## Reference Docs (gitignored)

Foundational (authoritative for building):

- `docs/foundational/mvp-spec.md` — MVP product spec
- `docs/foundational/mvp-technical-spec.md` — Technical spec

Context (earlier iterations, useful for background):

- `docs/context/v0-prd.md` — Full review-gate PRD (eventual full product vision)
- `docs/context/vision.md` — Market positioning and competitive landscape
- `docs/context/spec.md` — Original v0.3 spec (superseded by MVP specs)
- `docs/context/v0-lofi.html` — Low-fi prototype of review gate flow

## Tech Stack

- Node.js (CLI distributed via npx)
- Target warehouse: Snowflake (design partner one)
- No semantic layer dependency — works over documented marts
- Claude Code PostToolUse hook for automatic SQL capture
