---
name: htmlineage
description: Records where every number in an HTML data report came from, so a reviewer can trace each figure, chart and claim back to the query behind it. Use when the user asks for a report that will be reviewed, traced or shared with leadership, asks for lineage or htmlineage by name, or when project instructions say reports use htmlineage. Also use to review such a report or explain how one of its numbers was computed. Skip it for quick, throwaway analysis unless asked.
---

# htmlineage

While you build a report, you also write down how each thing on the page was
made: which query, which step, which value. That record is the lineage graph.
`htmlineage check` validates it and embeds it in the report. A reviewer can
then open any number and see the SQL behind it.

This changes nothing about how you query, chart or write. The report looks the
same with or without it. You add the graph and you run `check`.

## When to use it

Use it when the report will be reviewed before it is shared: the user says so,
asks for lineage or htmlineage, or the project's instructions say every report
there uses it. Do not use it for a quick look at some data, or when the user
says they do not need it. When you are unsure, ask once.

## The shape

Every value reaches the page by one path:

1. **Source.** Pull once, wide, per mart: one query per dataset, with the
   reporting period as literal dates.
2. **View.** Make a view for everything you show: each chart and each table
   is a SELECT over sources or other views.
3. **Figure.** Pick each number from a view: one cell. Or derive it from other
   figures with an expression.
4. **Insight.** Write each claim over the figures, views and insights it
   rests on.

If a claim rests on nothing you queried, keep it and mark it ungrounded. Never
leave it out to make the report look cleaner.

## Workflow

1. Query the warehouse the way you normally would. Write each source into the
   graph as you run it.
2. Write the graph to `.lineage/<report-stem>.json`, beside the report. For
   `growth-review.html` that is `.lineage/growth-review.json`. Add views,
   figures and insights to it as you build the page, not at the end.
3. Put `data-lineage="<id>"` on every element that shows a view, figure or
   insight. A number inside a sentence gets its own span.
4. Run `npx htmlineage check <report>.html`.
5. Fix every error. Most messages end with what to change. Run `check` again.
6. Fix the warnings you can. A warning does not fail the report, but each one
   is something a reviewer will see.
7. When you edit the page after this, update the graph to match and run
   `check` again. It is the last thing you do before you hand the report over.

`check` exits 0 when the report passes, with or without warnings, and 1 when
it does not. Exit 2 means the command was wrong (a bad flag, a missing file
name), not the graph: fix the command, not the graph. Never write the embedded
`<script>` block yourself; `check` does.

## Pin time

Every source names its period with literal dates, both in `period` and in its
SQL:

```sql
where order_date between '2026-08-01' and '2026-08-31'
```

Never use `current_date`, `now()`, `dateadd(…, current_date)` or "last 30
days". A report must give the same numbers when it is run again next month.

## Patterns

- **Ranks.** Add a `rank() over (…)` column to the view already on the page,
  then pick the rank as a figure. Do not make a separate unbound view for it.
- **Shares.** Pick from the view on the page with a subquery in the figure's
  SQL, for example a channel's count over the total, when no shown view has
  the share as a column.
- **A change or a ratio.** A figure with `expr` over other figures, such as
  `(f1 - f2) / f2`. It has no `sql`.
- **A change in a rate.** When a percentage moves, say whether the change is
  in points or relative: "up 4.9 points" or "a relative gain of 11.8%", never
  a bare "up 11.8%".
- **A name.** A figure can hold text, such as the top channel's name. Its
  `value` and `display` are the name.
- **A number you were told.** When someone hands you a number or a file (a
  target, a forecast, a CSV), make an external source with `given` saying what
  you were handed and by whom. Put a figure over it, and bind the figure. Never
  bind the source.
- **Copy `display` exactly.** The span's text is the figure's `display`,
  character for character: `46.6%`, not `46.60%` or `47%`.
- **Metric names.** Write `30-day retention`, not "retention over 30 days".
  `check` reads a number joined to a time unit by a hyphen as part of a
  definition, not a claim to trace.
- **Opinion and forecast.** A claim from judgement or outside knowledge is an
  insight with `"ungrounded": true` and `"from": []`. Ungrounded means no data
  backs it. A projection you can compute from figures, such as "at this pace
  we end the year at $1.47M", is an `expr` figure and the claim rests on it.
- **Every number a claim leans on.** If a claim depends on a quantity, that
  quantity is a figure shown on the page and the claim rests on it. "All of
  the growth came from new customers" needs new MRR on the page, not only the
  totals beside it.

## Describe each step

Sql sources, views and figures carry a `desc`: one line, 120 characters at
most, saying how the step was computed. A reviewer reads it before the SQL.

- Use business words. Name the population, the filter and the time window.
- No result values: the desc says how, not what came out.
- No SQL words: no `select`, `join`, column names or table names.

| Step               | Good                                                                          | Bad                                                           |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| sql source         | Retention by channel and cohort month, January to August 2026                 | select channel, retention_30d from marts.retention_by_channel |
| view               | Average 30-day retention for each channel and month, ranked within each month | Retention by channel, paid social leads at 46.6%              |
| figure with `sql`  | Paid social's 30-day retention for the August 2026 cohort                     | Pick from v1 where channel = paid_social                      |
| figure with `expr` | Change in paid social retention from July to August, relative to July         | (f1 - f2) / f2                                                |

A figure's `label` is what the number _is_ ("Paid social retention,
August"). Its `desc` is how it was _computed_.

## SQL style

The composed SQL is what a reviewer reads, so write it to be read:

- Lowercase keywords, one clause per line, one column per line.
- Name every computed column: `avg(retention_30d) as retention`.
- Aliases of three letters or more.
- A view or figure names its parents by id, as table names: `from q1`,
  `from v2`.
- List columns. No `select *`.

## Don't

- Give a figure its own query against the warehouse. It picks from a view or
  source that is already there.
- Leave a number in prose outside a `data-lineage` span.
- Use `current_date` or any relative date, anywhere.
- Chain views deeply. Each link is one more thing a reviewer has to read;
  two deep is usually enough.
- Drop a claim you cannot source. Mark it ungrounded instead.

## When asked how a number was computed

For a number, chart or claim in a report, your own or one you were handed,
take the id from the element's `data-lineage` attribute and run:

```
npx htmlineage sql <report>.html --id <id>
```

It prints one runnable script: the source, every view and the figure, in
order. Answer from that script rather than by reading the graph by hand.
`npx htmlineage view <report>.html` opens the report beside its lineage for a
person to click through.

## When asked to review a report

Follow [references/review.md](references/review.md). In short: read the check
summary with `--no-embed`, trace the numbers the report rests on with
`sql --id`, and report what is weak. Do not edit the report.

## References

- [references/format.md](references/format.md): every field of every kind of
  node, what may rest on what, ids, and binding. Open it when you write your
  first graph, or when `check` names a field you do not recognise.
- [references/example/](references/example/): a complete short report with
  its graph, the order it was built in, and the `check` output it gives. Read
  it before your first report; copy its shape.
- [references/review.md](references/review.md): how to review a report
  someone else built. Open it only when asked to review.
