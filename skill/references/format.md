# The lineage graph: field reference

## Files

A report is one HTML file. Its lineage graph is one JSON object kept in
`.lineage/<report-stem>.json`, beside the report. For `report.html` that is
`.lineage/report.json`. You write the graph there. `htmlineage check` embeds
it in the report as a `<script type="application/lineage+json">` block, so you
never write that block by hand.

The graph is a header and a `nodes` map keyed by id:

```json
{
  "lineage": "1.0",
  "nodes": {
    "q1": {},
    "v1": {},
    "f1": {},
    "i1": {}
  }
}
```

## Kinds of node

Every value on the page reaches it by one path: source, then view, then
figure, then insight. A node's `step` says which it is.

```json
{
  "step": "source",
  "kind": "sql",
  "desc": "Retention by channel and cohort month, January to August 2026",
  "mart": "marts.retention_by_channel",
  "period": { "from": "2026-01-01", "to": "2026-08-31" },
  "sql": "select\n    channel,\n    cohort_month,\n    retention_30d\nfrom marts.retention_by_channel\nwhere cohort_month between '2026-01-01' and '2026-08-31'",
  "columns": ["channel", "cohort_month", "retention_30d"]
}
```

```json
{
  "step": "source",
  "kind": "external",
  "type": "csv",
  "ref": "q3-targets.csv",
  "given": "A CSV with columns channel, target_retention, shared by the builder"
}
```

```json
{
  "step": "view",
  "from": ["q1"],
  "desc": "Average 30-day retention for each channel and cohort month",
  "sql": "select\n    channel,\n    cohort_month,\n    avg(retention_30d) as retention\nfrom q1\ngroup by channel, cohort_month",
  "columns": ["channel", "cohort_month", "retention"],
  "encoding": { "x": "cohort_month", "y": "retention", "series": "channel" }
}
```

```json
{
  "step": "figure",
  "from": ["v1"],
  "desc": "Paid social retention for August 2026",
  "sql": "select retention\nfrom v1\nwhere channel = 'paid_social'\n  and cohort_month = '2026-08-01'",
  "value": 0.466,
  "display": "46.6%",
  "label": "Paid social retention, August"
}
```

```json
{
  "step": "figure",
  "from": ["f1", "f2"],
  "expr": "(f1 - f2) / f2",
  "value": 0.1175,
  "display": "11.8%",
  "label": "Change in paid social retention, August vs July"
}
```

```json
{
  "step": "insight",
  "from": ["f3"],
  "text": "Paid social retention rose 11.8%."
}
```

A claim that rests on nothing you queried is still written down, marked
`"ungrounded": true` with `"from": []`.

## What may rest on what

- A view's `from` lists sources and views.
- A figure with `sql` lists sources and views in `from`. A figure with `expr`
  lists figures.
- An insight's `from` lists views, figures and insights. Never a source:
  sources do not appear on the page.
- A figure never gets its own query. It picks one cell from a view or source
  that exists, or it derives from other figures.

## Ids

- Lowercase letters, digits and `_`, starting with a letter.
- Start with the step's letter: `q` for a sql source, `x` for an external
  source, `v` for a view, `f` for a figure, `i` for an insight. For example
  `q1`, `x1`, `v1`, `f1`, `i1`.
- Each id is used once.

## Binding to the page

Put `data-lineage="<id>"` on the element that shows the node:

```html
<span data-lineage="f3">11.8%</span>
<p data-lineage="i1">
  Paid social retention rose <span data-lineage="f3">11.8%</span>.
</p>
<div data-lineage="v1"><svg></svg></div>
<table data-lineage="v2"></table>
```

- Views, figures and insights bind. Sources never do.
- Every view, figure and insight binds at least once. A figure shown in
  several places binds in each.
- A number inside a sentence sits in its own `data-lineage` span.
- A chart binds on the container around the SVG, not the SVG.
- The attribute adds no style and no behaviour.

## Fields

Each table below lists every field a node of that kind may carry. Required
means an error if it is missing. Expected means a warning if it is missing.

### sql source

| Field       | Required | Type   | Use                                                                 |
| ----------- | -------- | ------ | ------------------------------------------------------------------- |
| `step`      | required | string | `"source"`                                                          |
| `kind`      | required | string | `"sql"`                                                             |
| `desc`      | expected | string | One line, 120 characters at most: what the query pulls, in words    |
| `how`       | optional | string | Leave out                                                           |
| `mart`      | expected | string | The mart the query reads                                            |
| `period`    | expected | object | The pinned range, `{ "from": "2026-01-01", "to": "2026-08-31" }`    |
| `sql`       | expected | string | The query, with the period as literal dates                         |
| `columns`   | expected | list   | Output column names                                                 |
| `rows`      | optional | object | Up to 10 rows, columnar: `{ "column": [values] }`; or `null`        |
| `transform` | optional | string | A judgement the SQL does not show, such as "excluded the test week" |

### external source

| Field       | Required | Type   | Use                                           |
| ----------- | -------- | ------ | --------------------------------------------- |
| `step`      | required | string | `"source"`                                    |
| `kind`      | required | string | `"external"`                                  |
| `type`      | expected | string | What kind of thing it is, such as `csv`       |
| `ref`       | expected | string | How a reader can find it, such as a file name |
| `given`     | expected | string | What you were handed, in words                |
| `columns`   | optional | list   | Column names, if it has them                  |
| `rows`      | optional | object | Up to 10 rows, columnar; or `null`            |
| `transform` | optional | string | A judgement the data does not show            |

### view

| Field        | Required | Type   | Use                                                                              |
| ------------ | -------- | ------ | -------------------------------------------------------------------------------- |
| `step`       | required | string | `"view"`                                                                         |
| `from`       | required | list   | Ids of the sources and views it reads                                            |
| `desc`       | expected | string | One line, 120 characters at most: what it computes and how, in words             |
| `sql`        | required | string | A SELECT over the parents, which it names by id as table names                   |
| `columns`    | expected | list   | Output column names                                                              |
| `encoding`   | optional | object | For charts: `x`, `y`, `series`, `visual`, each a string                          |
| `rows`       | optional | object | Up to 10 rows, columnar; or `null`. A view shown as a table needs none           |
| `transform`  | optional | string | A judgement the SQL does not show                                                |
| `ungrounded` | optional | bool   | `true` when it has no source: `from` may then be empty and `sql` may be left out |

### figure

| Field        | Required             | Type          | Use                                                                                           |
| ------------ | -------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `step`       | required             | string        | `"figure"`                                                                                    |
| `from`       | required             | list          | Ids it reads: sources and views with `sql`, figures with `expr`                               |
| `desc`       | expected             | string        | One line, 120 characters at most: how it was computed, in words                               |
| `sql`        | one of `sql`, `expr` | string        | A single SELECT returning one cell, ideally a plain pick of one column from one row           |
| `expr`       | one of `sql`, `expr` | string        | A SQL scalar expression over figure ids, such as `(f1 - f2) / f2`. No comments                |
| `value`      | expected             | number/string | The number or name the page shows                                                             |
| `display`    | expected             | string        | The text exactly as shown on the page, such as `"46.6%"`                                      |
| `label`      | expected             | string        | What the number is, in words                                                                  |
| `transform`  | optional             | string        | A judgement the SQL does not show                                                             |
| `ungrounded` | optional             | bool          | `true` when it has no source: `from` may then be empty and neither `sql` nor `expr` is needed |

### insight

| Field        | Required | Type   | Use                                                                   |
| ------------ | -------- | ------ | --------------------------------------------------------------------- |
| `step`       | required | string | `"insight"`                                                           |
| `from`       | required | list   | Ids of the views, figures and insights the claim rests on             |
| `text`       | required | string | The claim, as it reads on the page                                    |
| `transform`  | optional | string | A judgement behind the claim that its sources do not show             |
| `ungrounded` | optional | bool   | `true` when the claim rests on nothing here: `from` may then be empty |

### header

| Field          | Required | Type   | Use                                                    |
| -------------- | -------- | ------ | ------------------------------------------------------ |
| `lineage`      | required | string | The format version, `"1.0"`                            |
| `nodes`        | required | object | Every node, keyed by id                                |
| `report_id`    | optional | string | A UUID, minted at the first build and kept on rebuilds |
| `built_at`     | optional | string | When the report was built, an ISO timestamp            |
| `builder_tool` | optional | string | The tool that built it, such as `report-builder`       |
| `signature`    | optional | string | Leave out                                              |
