# htmlineage

**A provenance layer for AI-generated reports.** Every number, chart, and claim traces back to the query that produced it.

AI writes analytics reports faster than data teams can vet them. htmlineage records where each figure came from — `source → view → figure → insight` — so a reviewer can see the lineage behind any claim before it reaches a CXO deck.

- **Visibility, not verification.** htmlineage shows the lineage; it doesn't assert the numbers are right.
- **Zero builder friction.** Reports stay plain `.html`. Lineage rides along in an inert `<script type="application/lineage+json">` block and `data-lineage` attributes — invisible to the reader.
- **SQL-first evidence.** Compose an entire report back into one runnable SQL script for review.
- **Pinned time.** Queries use absolute date ranges, never `now()`, so a report reproduces exactly.

## Status

⚠️ **Pre-release.** This is an early preview, published under the `next` tag. The lineage format may still change before `0.1.0`.

## Install

htmlineage has two parts: a skill that teaches your AI assistant to record lineage while it builds a report, and a CLI that checks, composes and shows it.

**The skill** follows the open [Agent Skills](https://agentskills.io) standard, so it works with Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot and other tools that read skills. Install it with [skills.sh](https://skills.sh):

```bash
npx skills add htmlineage/htmlineage -s htmlineage
```

Or copy [`skills/htmlineage/`](skills/htmlineage/) into your tool's skills folder (for example `.claude/skills/` for Claude Code, `.agents/skills/` for most others).

The skill is opt-in: your assistant uses it when you ask for a report that will be reviewed, traced or shared with leadership, and not for quick questions. To use it for every report in a repository, add a line such as "Every report built here uses htmlineage" to the instructions file your tool reads (`AGENTS.md`, `CLAUDE.md` or similar).

**The CLI** needs Node 18 or later and nothing else:

```bash
npx htmlineage@next --help
```

## Usage

```bash
npx htmlineage@next check report.html       # validate the lineage and embed it into the report
npx htmlineage@next sql report.html         # compose the whole report into one SQL script
npx htmlineage@next sql report.html --id f3 # the SQL behind one number
npx htmlineage@next view report.html        # open the report beside its lineage
```

Run `htmlineage <command> --help` for the options of each command.

### `check`

Reads the lineage graph from `.lineage/<report>.json` beside the report, checks it against the report's `data-lineage` bindings, embeds it into the HTML, and prints a summary. Exits `0` when the report passes (warnings still pass) and `1` when it does not. Use `--no-embed` to leave the file untouched and `--json` for machine-readable output.

### `sql`

Joins every source, view, and figure into a single script a reviewer can paste into the warehouse. `--id <node>` composes only that node and everything it rests on. External and ungrounded nodes are listed as trailing comments. A report that fails `check` is refused.

### `view`

Serves a two-pane page on `localhost`: the report on the left, the lineage of whatever you click on the right. It reads only the report and its graph — no database, no credentials. The viewer itself makes no requests off your machine.

## How lineage is recorded

A report's graph is a JSON object with a `nodes` map. Each node is one of four steps:

| Step        | Id  | What it is                                                              |
| ----------- | --- | ----------------------------------------------------------------------- |
| **source**  | `q` | One wide query per dataset, with a pinned date range                    |
|             | `x` | An external source htmlineage cannot see inside (a CSV, a document)     |
| **view**    | `v` | A `select` over sources or views, shown as a table or chart             |
| **figure**  | `f` | A single value picked from a view, or a SQL expression over figures     |
| **insight** | `i` | A claim resting on views, figures or insights, or flagged as ungrounded |

Elements on the page point at nodes:

```html
<div class="kpi-value" data-lineage="f1">46.6%</div>
```

Every field of every step is in the [field reference](skills/htmlineage/references/format.md), and a complete short report with its graph is in the [worked example](skills/htmlineage/references/example/).

## License

Apache-2.0 © Varun Jain
