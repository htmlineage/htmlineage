# Reviewing a report

Use this when you are asked to review a report someone else built, or to check
one before it is shared. Your job is to show the reviewer what each number and
claim rests on and where that is weak. You do not decide whether the report is
right, and you do not change it.

## 1. Read the check summary

```
npx htmlineage check <report>.html --no-embed
```

`--no-embed` leaves the file untouched. Read the summary. It lists errors
last, but take them first:

- **Errors.** The lineage is broken. Say so first: nothing below can be traced
  with confidence until the builder fixes it, and `htmlineage sql` refuses
  a report with errors.
- **Ungrounded.** Claims and numbers that rest on nothing queried: a forecast,
  an opinion, outside knowledge. List each one with its text. They may be
  fine, but the reader should know they are not backed by data.
- **External.** Data the builder was handed: a CSV, a number someone said.
  Name each one and who it came from (its `given`). A reviewer may want to
  confirm it with that person.
- **Warnings.** Each is a gap a reader could trip on. The ones that matter
  most: a number in prose with no lineage (C2), a page that shows a different
  value from the graph (C3), and a source without literal dates (C7).

## 2. Trace the numbers that carry the report

Pick the headline numbers and the ones the main claims rest on. For each, take
its id from the element's `data-lineage` attribute and run:

```
npx htmlineage sql <report>.html --id <id>
```

Read the script against the claim on the page:

- **Population.** Does the source cover who the claim is about? A claim about
  all customers over a source filtered to one region is a finding.
- **Period.** Do the literal dates match the period the page names?
- **Comparison.** Is a change measured against the base the text says (last
  month, last year, target)?
- **Definition.** Does the metric match its name: a 30-day rate computed over
  30 days, a share over the right total?
- **Descriptions.** Does each step's `desc` say what its SQL does? A `desc`
  that promises more than the SQL is a finding.

`npx htmlineage sql <report>.html` with no `--id` composes the whole report into
one script, if the reviewer wants everything at once.

## 3. Rerun, if you can and are asked to

If you have read access to the warehouse and the reviewer wants the numbers
reproduced, run the script from step 2 and compare its result with the figure's
`display` on the page. Run it as it is; do not rewrite it first. Report any
difference with both values. Because every source has literal dates, the script
should give the same result as when the report was built, unless the
underlying data has changed since.

Never run anything that writes to the warehouse.

## 4. Report back

A short list, most serious first:

1. Errors, if any.
2. Findings from step 2 and step 3: the id, what the page says, what the SQL
   does, and why it matters.
3. Ungrounded claims and external data, so the reader knows what to take on
   trust.
4. Anything you checked and found sound, briefly. "f1, f3 and f5 trace cleanly
   to the August retention query" is useful to a reviewer.

Do not edit the report or its graph. If the builder should change something,
say what and why. For a person to click through the lineage themselves, point
them to `npx htmlineage view <report>.html`.
