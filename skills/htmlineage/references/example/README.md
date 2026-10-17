# Worked example

A short report as you should leave it before you run `check`: the graph sits
in `.lineage/august-retention.json`, the page in `august-retention.html` has
no embedded block, and the graph header holds only `lineage` and `nodes`.
Read the JSON beside the page. `check` embeds the graph for you.

## Prompt

> Build a one-page August retention report for the growth review: paid social's
> 30-day retention against July, how it ranks among the channels, and its share
> of new customers. Compare retention with the targets the growth lead sent.

## Build order

The queries and steps in the order they were made. Each id appears once.

1. `q1` source: one wide pinned query on `marts.retention_by_channel`, January to August 2026.
2. `q2` source: one wide pinned query on `marts.acquisition_by_channel`, August 2026.
3. `x1` external source: the retention targets the growth lead shared as a CSV. You were handed it, so it has `given` and no `sql`.
4. `v1` view: retention by channel and month, with a `rank() over` column. It is the line chart.
5. `v2` view: August new customers and retention by channel. It is the table.
6. `f1` figure: paid social's August retention, picked from `v1`.
7. `f2` figure: its July retention, picked from `v1`.
8. `f3` figure: the change on July, an `expr` over `f1` and `f2`, with no `sql`.
9. `f4` figure: its August rank, picked from `v1`.
10. `f5` figure: its share of August new customers, a subquery over `v2`.
11. `f6` figure: the top channel's name. A figure can hold text.
12. `f7` figure: paid social's August target, picked from `x1`.
13. `i1` insight: the headline, resting on `f6`.
14. `i2` insight: the retention paragraph, resting on `f1`, `f2`, `f3` and `f4`.
15. `i3` insight: the share paragraph, resting on `f5` and the insight `i2`.
16. `i4` insight: a forecast no query backs. It has `from: []` and `ungrounded: true`.

## Check output

```text
august-retention.html

  sources    3   (1 external)
  views      2   all shown on the page
  figures    7   6 fully traced, 1 partially traced
  insights   4   3 fully traced, 1 ungrounded

  needs attention
    i4   ungrounded   "Paid social's gain is likely to hold int…"
    x1   external     channel-retention-targets.csv — a reader will be asked to confirm this with you
```

`i4` and `x1` are listed on purpose. They show a reader what is not backed by a query.
Everything else passes with no error and no warning.
