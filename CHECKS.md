# What `htmlineage check` reports

`htmlineage check` reads a report's lineage graph, checks it against the HTML, and prints a summary. Anything a reviewer should look at is listed under "needs attention", one row per issue: the node id, the rule code, the severity and a message. This page explains each rule: what it means, an example of what `check` prints, and how to fix it.

## Errors and warnings

Every rule has one fixed severity.

- **error:** the graph cannot be read or composed as written. `check` exits 1 and does not embed the graph into the report.
- **warning:** it works, but a reviewer would want more. `check` exits 0 and embeds the graph. The warning stays visible in the summary and the viewer until it is fixed.

Ungrounded and external rows in the summary are not issues. They are listed so the builder sees them, but they never fail a check.

## Exit codes

- **0:** the report passed. Warnings are allowed.
- **1:** the report failed: at least one error, or a file that could not be read or written.
- **2:** the command was invoked wrongly and never ran.

## Shape rules

The S rules look at the graph one node at a time.

### S1: graph header is malformed

**Severity:** error

The top-level object is wrong: the format version is missing or not one this build reads, there is no `nodes` object, or `report_id`, `builder_tool` or `built_at` has the wrong type. Nothing below the header can be trusted.

```
graph   S1 error   format version 2.0 is not supported; this build reads 1.x
```

Other messages from this rule include ``missing `lineage` format version``, ``missing `nodes` ``, and `` `built_at` must be an ISO timestamp ``.

**Fix:** start the graph with `"lineage": "1.0"` and put the nodes in an object keyed by id. Timestamps look like `2026-09-16T14:20:00Z`.

### S2: node id is not a valid identifier

**Severity:** error

Node ids become table names in the composed SQL, so they must be plain identifiers: lowercase letters, digits and `_`, starting with a letter.

```
Top-Plan   S2 error   `Top-Plan` is not a valid id; use lowercase letters, digits and _, starting with a letter
```

**Fix:** rename the node, for example to `i5`, and update every `from` list and `data-lineage` attribute that used the old id.

### S3: node step is missing or unknown

**Severity:** error

Every node must be one of the four steps: `source`, `view`, `figure` or `insight`. Without a known step no other shape rule can check the node, so it is skipped from here on.

```
m1   S3 error   unknown step "metric"; expected one of source, view, figure, insight
```

**Fix:** a single number is a figure. A table or chart is a view.

### S4: field is missing or has the wrong type

**Severity:** error

A field the step needs is absent, or a field is present with the wrong type. Required: `kind` on a source; `from` on every view, figure and insight; `sql` on a grounded view; `text` on an insight.

```
i1   S4 error   insight is missing `text`; add it: the claim, as text
```

Other messages from this rule include `` `from` must be a list of node ids ``, `` `kind` must be "sql" or "external" `` and `node must be an object, got a list`.

**Fix:** add the field, or correct its type. For an insight, `text` is the claim as it reads on the page.

### S5: unknown field

**Severity:** warning

A field the format does not define on that step. It is kept, but nothing reads it, so it is often a typo (`colums`) or a note that belongs somewhere else.

```
v1   S5 warning   unknown field `notes` on a view
```

**Fix:** remove the field, correct its spelling, or put the note in a SQL comment where the reviewer will see it.

### S6: node id prefix does not match its step

**Severity:** warning

By convention ids start with a letter for their kind: `q` for a sql source, `x` for an external source, `v` for a view, `f` for a figure, `i` for an insight. Other ids still work, but they read worse in the viewer and in the composed script.

```
t1   S6 warning   external source ids conventionally start with `x`, e.g. x1
```

**Fix:** rename the node to follow the convention, and update every `from` list and `data-lineage` attribute that used the old id.

### S7: descriptive field is missing

**Severity:** warning

The node works, but a reviewer would lack context. A figure wants `value`, `display` and `label`. A view wants `columns`. An external source wants `type`, `ref` and `given`. Views, figures and sql sources also want a `desc`, unless they are ungrounded.

```
f1   S7 warning   figure has no `label` (what the number is, in words)
```

**Fix:** add the field the message names, for example `"label": "Paid search cost per new customer, Q3"`.

### S8: figure expression cannot be read

**Severity:** warning

A figure's `expr` is a small arithmetic language over other figures: `+ - * /`, parentheses, numbers, figure ids, `abs()` and `round(x, places)`. Anything else is rejected, with the character position.

```
f1   S8 warning   cannot read `f2 / (f3` at character 6: `(` is never closed
```

**Fix:** correct the expression at the position given. Anything beyond arithmetic, such as ranks, shares or windows, belongs in a view's SQL, picked out by a figure with `sql`.

### S9: description is too long or not one line

**Severity:** warning

A `desc` is one short line saying what the step computes, in words. It is shown in the viewer's outline, where a long or multi-line description does not fit.

```
v1   S9 warning   `desc` has a line break; keep it to one line of 120 or fewer
```

**Fix:** shorten the `desc` to one line of 120 characters or fewer.

## Consistency rules

The C rules look across nodes, or at how the graph lines up with the HTML.

### C1: binding and node do not match up

**Severity:** error

Every `data-lineage` attribute on the page must name a node, and every view, figure and insight must be bound to something on the page. Sources are never bound directly: a reader clicks the figure over them.

```
f9   C1 error   data-lineage="f9" resolves to no node; add a node with that id to the graph, or correct the id on the page
```

The same rule, in the other direction:

```
v2   C1 error   view is not bound to any element on the page; add data-lineage="v2" to the element that shows it
q1   C1 error   `q1` is a source; bind a figure over it instead
```

**Fix:** add the missing node, or correct the id in the HTML. Delete nodes the page no longer shows.

### C2: number in prose is outside a figure's span

**Severity:** warning

Every number the report states should be clickable back to its query. A bare number in the text has no lineage. Text inside bound tables, charts and ungrounded insights is not scanned. Years, ISO dates, metric definitions such as "30-day", and digits inside a name such as "B2B" are not counted as numbers.

```
i1   C2 warning   bare number "1,240" is not inside a figure's span
```

**Fix:** add a figure for the number and wrap it on the page, for example `<span data-lineage="f5">1,240</span>`.

### C3: figure text does not match its display or value

**Severity:** warning

The text inside a figure's span must equal its `display`, or read as a number that rounds to its `value`. A mismatch usually means the page was edited after the query ran.

```
f1   C3 warning   page shows "$58.90" but display is "$61.20"; copy `display` onto the page exactly, or update `value` and `display` if the page is right
```

Rounding is allowed: with `"value": 0.1127`, the page may show `11.3%` or `11%`.

**Fix:** decide which is right. Re-run the query and update `value` and `display`, or correct the page text.

### C4: node has no parents and is not marked ungrounded

**Severity:** error

An empty `from` means a claim with nothing under it. That is allowed, but only when it is said out loud with `ungrounded: true`, so the reader sees it.

```
i1   C4 error   `from` is empty; list the parents, or set `ungrounded: true` if there are none
```

**Fix:** point `from` at the nodes that support the claim, or add `"ungrounded": true`. It then shows as ungrounded in the summary, which is not a failure.

### C5: `from` breaks the source → view → figure → insight chain

**Severity:** error

Each step rests only on the step before it, so the chain always reads the same way.

| Node             | May rest on                                            |
| ---------------- | ------------------------------------------------------ |
| view             | sources and views only                                 |
| figure with sql  | sources and views only                                 |
| figure with expr | figures only, and every id in `expr` must be in `from` |
| insight          | views, figures and insights only, never a source       |

```
i2   C5 error   an insight rests on views, figures and insights only; put a figure over the source and rest the insight on that
```

The rule also reports ids in `from` that are not nodes, and ids used in `expr` that are missing from `from`:

```
f3   C5 error   `from` names f7, which is not a node; add that node, or remove it from `from`
```

**Fix:** put a figure over the source and rest the insight on that, or rest it on a view. For the other cases, follow the fix in the message.

### C6: nodes depend on each other in a cycle

**Severity:** error

Following `from` must always end at a source. A loop has no bottom, so it cannot be traced or composed into SQL. Each cycle is reported once, starting from the node listed first in the graph.

```
f3   C6 error   cycle f3 -> f4 -> f3; break the loop: take f4 out of f3's `from`, or remove another link in it
```

**Fix:** one of the nodes must rest on something real. Rebuild it from the view or source it was derived from.

### C7: sql source is incomplete or not pinned to its period

**Severity:** warning

A sql source should carry `mart`, `period`, `sql` and `columns`, and its SQL must use the period's dates as literals. Clock functions such as `current_date` make the query return different data tomorrow, so the report cannot be reproduced.

```
q2   C7 warning   sql source is missing `columns`; SQL does not contain the period as literal dates: '2026-08-01', '2026-08-31'; SQL uses date functions: current_date
```

**Fix:** write `where session_date between '2026-08-01' and '2026-08-31'` and add the missing fields. Date arithmetic over literals, such as `dateadd('day', -30, '2026-08-31')`, is fine.

### C8: SQL breaks the style rules

**Severity:** warning

Three mechanical checks on every source, view and figure query. They scan words and parentheses, never meaning, and skip comments and strings.

- **select star:** the query uses `select *`. The reviewer should see which columns the number depends on.
- **date function:** the query uses a date function such as `now` instead of literal ISO dates. On sources, C7 reports this instead.
- **parent ref:** the query does not name one of the view's or figure's `from` parents by node id. The composed script names each step by node id, so reading a table directly would bypass the parent.

```
v1   C8 warning   SQL style: uses select *; list the columns
```

**Fix:** list the columns, use literal dates, and select from the parent by its node id, for example `select channel, spend from v1`.

### C9: figure needs exactly one of `sql` or `expr`

**Severity:** error

A figure is either read from a view by a query, or computed from other figures by an expression. With both, it is unclear which produced the number. With neither, nothing did, unless it is marked ungrounded.

```
f1   C9 error   figure has both `sql` and `expr`; keep exactly one
```

The other case reads ``figure has neither `sql` nor `expr`; add one, or set `ungrounded: true` ``.

**Fix:** keep the one that actually produced the value.
