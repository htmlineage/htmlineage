import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { readPage } from "../src/html/page.js";
import { buildPayload } from "../src/viewer/payload.js";
import {
  CLEAN_F3_SQL,
  CLEAN_SQL,
  loadFixture,
  runCli,
  tempDir,
} from "./helpers.js";

import {
  nodeState,
  title,
  outline,
  outlineKeys,
  ownCard,
  inputRow,
  stepText,
  stepFacts,
  stepHead,
  selection,
  reportCounts,
  highlightSql,
  reportSql,
  chainSql,
  stepSql,
  nodesOf,
  copyText,
  fromReport,
  isArithmetic,
  exprParts,
  tidyExpr,
  groundOf,
  grounding,
  headline,
  builtOn,
  builtFrom,
  mismatches,
  untraced,
  checkStatus,
} from "../src/viewer/client/lineage.js";

const G = {
  lineage: "1.0",
  nodes: {
    q1: {
      step: "source",
      kind: "sql",
      mart: "marts.sales",
      sql: "-- Sales by day\nselect day, amount from marts.sales",
    },
    q2: {
      step: "source",
      kind: "sql",
      mart: "marts.costs",
      sql: "select day, cost from marts.costs",
    },
    x1: { step: "source", kind: "external", type: "csv", ref: "targets.csv" },
    v1: {
      step: "view",
      from: ["q1"],
      sql: "-- Daily sales\nselect day, amount from q1",
      encoding: { visual: "table" },
    },
    v2: {
      step: "view",
      from: ["v1"],
      sql: "select day from v1",
      encoding: { visual: "bar" },
    },
    f1: {
      step: "figure",
      from: ["v1"],
      sql: "select sum(amount) from v1",
      label: "Sales",
      value: 12,
      display: "12",
    },
    f2: {
      step: "figure",
      from: ["q2"],
      sql: "select sum(cost) from q2",
      label: "Cost",
      value: 4,
      display: "4",
    },
    f3: {
      step: "figure",
      from: ["f2", "f1"],
      expr: "f1 - f2",
      label: "Margin",
      value: 8,
      display: "8",
    },
    f4: {
      step: "figure",
      from: ["x1"],
      sql: "select target from x1",
      value: 10,
      display: "10",
    },
    f5: {
      step: "figure",
      from: ["v1"],
      sql: "select count(day) from v1",
      label: "Days",
      value: 3,
      display: "3",
    },
    f6: {
      step: "figure",
      from: ["f1", "f5"],
      expr: "f1 / f5",
      label: "Sales per day",
      value: 4,
      display: "4",
    },
    f7: {
      step: "figure",
      from: ["f1", "f9"],
      expr: "f1 + f9",
      label: "Broken",
      value: 12,
      display: "12",
    },
    i1: { step: "insight", from: ["f3"], text: "Margin was 8." },
    i2: {
      step: "insight",
      from: [],
      ungrounded: true,
      text: "Margins will rise.",
    },
  },
};
// A /data.json object; override what a test needs.
const data = (over = {}) => ({
  report: "r.html",
  html: "",
  graph: G,
  trace: {},
  summary: {
    report: "r.html",
    counts: {},
    ungrounded: [],
    external: [],
    issues: [],
  },
  composedReport: null,
  composed: {},
  refused: null,
  ...over,
});

const fx = (name) => buildPayload({ reportPath: loadFixture(name).reportPath });

const REFUSED =
  "r.html does not pass `htmlineage check`, so no script was composed";
// Issues as check reports them.
const issue = (code, node, message, severity = "warning") => ({
  code,
  severity,
  node,
  field: null,
  message,
});
// traceGraph(G), written out.
const TRACE_G = {
  q1: "full",
  q2: "full",
  x1: "partial",
  v1: "full",
  v2: "full",
  f1: "full",
  f2: "full",
  f3: "full",
  f4: "partial",
  f5: "full",
  f6: "full",
  f7: "partial",
  i1: "full",
  i2: "ungrounded",
};
// G with its trace; override what a test needs.
const dg = (over = {}) => data({ trace: TRACE_G, ...over });

describe("groundOf", () => {
  it("calls an id that is not in the graph none", () => {
    assert.equal(groundOf(dg(), "f9"), "none");
  });
  it("calls anything traced to a sql source sql", () => {
    assert.equal(groundOf(dg(), "q1"), "sql");
    assert.equal(groundOf(dg(), "f3"), "sql");
  });
  it("calls an external source a file", () => {
    assert.equal(groundOf(dg(), "x1"), "file");
  });
  it("calls a figure on an external source a file", () => {
    assert.equal(groundOf(dg(), "f4"), "file");
  });
  it("finds a file further down a mixed chain", () => {
    const d = dg({
      graph: {
        nodes: {
          ...G.nodes,
          f8: { step: "figure", from: ["f1", "f4"], expr: "f1 + f4" },
        },
      },
      trace: { ...TRACE_G, f8: "partial" },
    });
    assert.equal(groundOf(d, "f8"), "file");
  });
  it("calls an ungrounded claim, or a chain broken by a missing parent, none", () => {
    assert.equal(groundOf(dg(), "i2"), "none");
    assert.equal(groundOf(dg(), "f7"), "none");
  });
  it("calls an ungrounded claim that reads a file none", () => {
    const d = dg({
      graph: {
        nodes: {
          ...G.nodes,
          i3: {
            step: "insight",
            ungrounded: true,
            from: ["f4"],
            text: "Below target.",
          },
        },
      },
      trace: { ...TRACE_G, i3: "ungrounded" },
    });
    assert.equal(groundOf(d, "i3"), "none");
  });
  it("calls a cycle none, and returns", () => {
    const d = data({
      graph: {
        nodes: {
          f3: { step: "figure", from: ["f4"], expr: "f4 + 1" },
          f4: { step: "figure", from: ["f3"], expr: "f3 * 2" },
        },
      },
      trace: { f3: "partial", f4: "partial" },
    });
    assert.equal(groundOf(d, "f3"), "none");
  });
  it("calls a file chain broken by a missing parent none", () => {
    const d = dg({
      graph: {
        nodes: {
          ...G.nodes,
          f8: { step: "figure", from: ["x1", "gone"], expr: "x1 + gone" },
        },
      },
      trace: { ...TRACE_G, f8: "partial" },
    });
    assert.equal(groundOf(d, "f8"), "none");
  });
  it("calls a cycle that also reaches a file none", () => {
    const d = data({
      graph: {
        nodes: {
          x1: G.nodes.x1,
          f3: { step: "figure", from: ["x1", "f4"], expr: "x1 + f4" },
          f4: { step: "figure", from: ["f3"], expr: "f3 * 2" },
        },
      },
      trace: { f3: "partial", f4: "partial" },
    });
    assert.equal(groundOf(d, "f3"), "none");
  });
  it("still finds a file when two paths meet on it", () => {
    const d = dg({
      graph: {
        nodes: {
          ...G.nodes,
          f8: { step: "figure", from: ["f4", "x1"], expr: "f4 + x1" },
        },
      },
      trace: { ...TRACE_G, f8: "partial" },
    });
    assert.equal(groundOf(d, "f8"), "file");
  });
});

// A summary carrying these issues.
const withIssues = (issues, over = {}) =>
  dg({ summary: { ...data().summary, issues }, ...over });
const EMPTY = data({ graph: { nodes: {} }, trace: {} });
const C2 = (node, number) =>
  issue("C2", node, `bare number "${number}" is not inside a figure's span`);

describe("grounding", () => {
  it("counts nothing in an empty graph", () => {
    assert.deepEqual(grounding(EMPTY), {
      numbers: { sql: 0, file: 0, none: 0 },
      claims: { supported: 0, unsupported: 0 },
    });
  });
  it("counts figures by what they rest on, and no other step", () => {
    assert.deepEqual(grounding(dg()).numbers, { sql: 5, file: 1, none: 1 });
  });
  it("counts claims supported or stated without support", () => {
    assert.deepEqual(grounding(dg()).claims, { supported: 1, unsupported: 1 });
  });
  it("counts a claim that rests on a file as supported", () => {
    const d = dg({
      graph: {
        nodes: {
          ...G.nodes,
          i3: { step: "insight", from: ["f4"], text: "Below target." },
        },
      },
      trace: { ...TRACE_G, i3: "partial" },
    });
    assert.deepEqual(grounding(d).claims, { supported: 2, unsupported: 1 });
  });
  it("counts each bare number as a number with nothing behind it", () => {
    const d = withIssues([C2("i1", "1,240"), C2(null, "30")]);
    assert.deepEqual(grounding(d).numbers, { sql: 5, file: 1, none: 3 });
  });
});

describe("headline", () => {
  it("says when every number and claim is grounded", () => {
    assert.deepEqual(
      headline({
        numbers: { sql: 6, file: 0, none: 0 },
        claims: { supported: 3, unsupported: 0 },
      }),
      {
        numbers: "All 6 numbers trace to the warehouse.",
        claims: "All 3 claims are supported.",
      },
    );
  });
  it("counts each part, in the plural", () => {
    assert.deepEqual(
      headline({
        numbers: { sql: 2, file: 2, none: 2 },
        claims: { supported: 2, unsupported: 2 },
      }),
      {
        numbers:
          "2 of 6 numbers trace to the warehouse. 2 rest on a file. 2 have nothing behind them.",
        claims: "2 of 4 claims are supported. 2 are stated without support.",
      },
    );
  });
  it("uses the singular for one", () => {
    assert.deepEqual(
      headline({
        numbers: { sql: 1, file: 1, none: 1 },
        claims: { supported: 1, unsupported: 1 },
      }),
      {
        numbers:
          "1 of 3 numbers traces to the warehouse. 1 rests on a file. 1 has nothing behind it.",
        claims: "1 of 2 claims is supported. 1 is stated without support.",
      },
    );
  });
  it("leaves out a part with nothing in it, but not the first", () => {
    assert.deepEqual(
      headline({
        numbers: { sql: 0, file: 0, none: 2 },
        claims: { supported: 0, unsupported: 3 },
      }),
      {
        numbers:
          "0 of 2 numbers trace to the warehouse. 2 have nothing behind them.",
        claims: "0 of 3 claims are supported. 3 are stated without support.",
      },
    );
  });
  it('says one grounded number or claim without "All"', () => {
    assert.deepEqual(
      headline({
        numbers: { sql: 1, file: 0, none: 0 },
        claims: { supported: 1, unsupported: 0 },
      }),
      {
        numbers: "1 number traces to the warehouse.",
        claims: "1 claim is supported.",
      },
    );
  });
  it("gives no line when there are no numbers or no claims", () => {
    assert.deepEqual(headline(grounding(EMPTY)), {
      numbers: null,
      claims: null,
    });
  });
});

// builtOn(dg()) rows, reused below.
const Q1 = {
  node: "q1",
  kind: "sql",
  name: "marts.sales",
  period: null,
  pinned: true,
  numbers: 5,
};
const Q2 = {
  node: "q2",
  kind: "sql",
  name: "marts.costs",
  period: null,
  pinned: true,
  numbers: 2,
};
const X1 = { node: "x1", kind: "external", name: "targets.csv", numbers: 1 };
const AUG = { from: "2026-08-01", to: "2026-08-31" };

describe("builtOn", () => {
  const q1Aug = (over = {}) =>
    data({
      graph: {
        nodes: {
          q1: { step: "source", kind: "sql", mart: "marts.sales", period: AUG },
        },
      },
      trace: { q1: "full" },
      ...over,
    });
  it("lists nothing when there are no sources", () => {
    assert.deepEqual(builtOn(EMPTY), []);
  });
  it("gives a mart's name and period", () => {
    assert.deepEqual(builtOn(q1Aug()), [
      {
        node: "q1",
        kind: "sql",
        name: "marts.sales",
        period: AUG,
        pinned: true,
        numbers: 0,
      },
    ]);
  });
  it("calls a source with a C7 not pinned", () => {
    const d = q1Aug({
      summary: {
        ...data().summary,
        issues: [issue("C7", "q1", "SQL uses date functions: current_date")],
      },
    });
    assert.deepEqual(builtOn(d), [
      {
        node: "q1",
        kind: "sql",
        name: "marts.sales",
        period: AUG,
        pinned: false,
        numbers: 0,
      },
    ]);
  });
  it("calls a source pinned when its only C7 is about columns", () => {
    const d = withIssues([
      issue("C7", "q1", "sql source is missing `columns`"),
    ]);
    assert.deepEqual(builtOn(d)[0], Q1);
  });
  it("calls a source not pinned for each period problem", () => {
    for (const message of [
      "sql source is missing `period`",
      "sql source is missing `mart`, `sql`",
      "SQL does not contain the period as literal dates: '2026-08-01'",
      "sql source is missing `columns`; SQL uses date functions: current_date",
    ]) {
      const d = withIssues([issue("C7", "q1", message)]);
      assert.equal(builtOn(d)[0].pinned, false, message);
      assert.equal(stepFacts(d, "q1").pinned, false, message);
    }
  });
  it("gives an external source's ref", () => {
    const d = data({
      graph: { nodes: { x1: G.nodes.x1 } },
      trace: { x1: "partial" },
    });
    assert.deepEqual(builtOn(d), [
      { node: "x1", kind: "external", name: "targets.csv", numbers: 0 },
    ]);
  });
  it("counts the numbers resting on each source, in graph order", () => {
    assert.deepEqual(builtOn(dg()), [Q1, Q2, X1]);
  });
  it("counts the numbers in a cycle that reaches a source, and returns", () => {
    const d = data({
      graph: {
        nodes: {
          q1: { step: "source", kind: "sql", mart: "m" },
          f3: { step: "figure", from: ["f4"] },
          f4: { step: "figure", from: ["f3", "q1"] },
        },
      },
      trace: {},
    });
    assert.equal(builtOn(d)[0].numbers, 2);
  });
  it("gives a sql source with no mart no name", () => {
    const d = data({
      graph: { nodes: { q1: { step: "source", kind: "sql" } } },
      trace: {},
    });
    assert.deepEqual(builtOn(d), [
      {
        node: "q1",
        kind: "sql",
        name: null,
        period: null,
        pinned: true,
        numbers: 0,
      },
    ]);
  });
});

describe("builtFrom", () => {
  it("gives a source its own row", () => {
    assert.deepEqual(builtFrom(dg(), "x1"), [X1]);
  });
  it("gives the sources under a figure in graph order", () => {
    assert.deepEqual(builtFrom(dg(), "f3"), [Q1, Q2]);
  });
  it("gives nothing for an ungrounded claim, and skips a missing parent", () => {
    assert.deepEqual(builtFrom(dg(), "i2"), []);
    assert.deepEqual(builtFrom(dg(), "f7"), [Q1]);
  });
});

describe("mismatches", () => {
  const c3 = (message) => withIssues([issue("C3", "f1", message)]);
  it("lists nothing when no number differs", () => {
    assert.deepEqual(mismatches(dg()), []);
  });
  it("gives the number on the page and the one in the graph", () => {
    assert.deepEqual(
      mismatches(c3('page shows "$58.90" but display is "$61.20"')),
      [{ node: "f1", page: ["$58.90"], graph: "$61.20" }],
    );
  });
  it("gives every text the page shows", () => {
    assert.deepEqual(
      mismatches(c3('page shows "$58.90", "$59.00" but display is "$61.20"'))[0]
        .page,
      ["$58.90", "$59.00"],
    );
  });
  it("gives the value when the figure has no display", () => {
    assert.deepEqual(mismatches(c3('page shows "47%" but value is 0.466')), [
      { node: "f1", page: ["47%"], graph: "0.466" },
    ]);
  });
  it("keeps a display that contains a semicolon whole", () => {
    assert.deepEqual(
      mismatches(
        c3('page shows "Paid social" but display is "Paid social; Organic"'),
      ),
      [{ node: "f1", page: ["Paid social"], graph: "Paid social; Organic" }],
    );
  });
  it("keeps a C3 it cannot read, with no values", () => {
    assert.deepEqual(mismatches(c3("display is `x`")), [
      { node: "f1", page: [], graph: null },
    ]);
  });
});

describe("untraced", () => {
  it("lists nothing when everything is grounded", () => {
    const d = data({
      graph: {
        nodes: {
          q1: G.nodes.q1,
          f1: { step: "figure", from: ["q1"], display: "12" },
        },
      },
      trace: { q1: "full", f1: "full" },
    });
    assert.deepEqual(untraced(d), []);
  });
  it("lists a figure with nothing behind it", () => {
    const d = data({
      graph: {
        nodes: {
          f8: { step: "figure", from: [], ungrounded: true, display: "$50" },
        },
      },
      trace: { f8: "ungrounded" },
    });
    assert.deepEqual(untraced(d), [
      { node: "f8", kind: "figure", text: "$50" },
    ]);
  });
  it("lists a claim stated without support", () => {
    const d = data({
      graph: { nodes: { i2: G.nodes.i2 } },
      trace: { i2: "ungrounded" },
    });
    assert.deepEqual(untraced(d), [
      { node: "i2", kind: "claim", text: "Margins will rise." },
    ]);
  });
  it("lists a bare number with the node it sits in", () => {
    const d = data({
      graph: { nodes: {} },
      trace: {},
      summary: {
        ...data().summary,
        issues: [C2("i1", "1,240"), C2(null, "30")],
      },
    });
    assert.deepEqual(untraced(d), [
      { node: "i1", kind: "bare", text: "1,240" },
      { node: null, kind: "bare", text: "30" },
    ]);
  });
  it("lists figures, then bare numbers, then claims", () => {
    assert.deepEqual(untraced(withIssues([C2("i1", "1,240")])), [
      { node: "f7", kind: "figure", text: "12" },
      { node: "i1", kind: "bare", text: "1,240" },
      { node: "i2", kind: "claim", text: "Margins will rise." },
    ]);
  });
  it("keeps a C2 it cannot read, as check's message", () => {
    const rows = untraced(withIssues([issue("C2", "i1", "odd `thing`")]));
    assert.deepEqual(
      rows.find((r) => r.kind === "bare"),
      { node: "i1", kind: "bare", text: "odd `thing`" },
    );
  });
});

describe("checkStatus", () => {
  const s5 = issue("S5", "v1", "unknown field `notes` on a view");
  const c1 = issue("C1", "f9", "x", "error");
  const c6 = issue("C6", "f3", "y", "error");
  it("says check is clean", () => {
    assert.deepEqual(checkStatus(dg()), {
      line: "check · clean",
      issues: [],
      reason: null,
    });
  });
  it("counts warnings as notes, and lists every one, C2 included", () => {
    const c2 = C2("i1", "1,240");
    assert.deepEqual(checkStatus(withIssues([s5, c2])), {
      line: "check · 2 notes",
      issues: [s5, c2],
      reason: null,
    });
  });
  it("uses the singular for one", () => {
    assert.equal(
      checkStatus(withIssues([issue("C1", "f9", "x", "error"), s5])).line,
      "check · 1 error · 1 note",
    );
  });
  it("lists errors before warnings, each in check's order", () => {
    const status = checkStatus(withIssues([s5, c1, c6]));
    assert.equal(status.line, "check · 2 errors · 1 note");
    assert.deepEqual(status.issues, [c1, c6, s5]);
  });
  it("gives sql's reason when the report fails check", () => {
    assert.equal(
      checkStatus(withIssues([c1], { refused: REFUSED })).reason,
      REFUSED,
    );
  });
});

describe("nodesOf", () => {
  it("gives a graph's nodes as they are", () => {
    assert.deepEqual(nodesOf(G), G.nodes);
  });
  it("gives no nodes for a graph that is not an object", () => {
    for (const graph of [null, "x", 5, []]) {
      assert.deepEqual(nodesOf(graph), {});
    }
  });
  it("gives no nodes when nodes is missing or not an object", () => {
    for (const nodes of [undefined, 5, [], null]) {
      assert.deepEqual(nodesOf({ lineage: "1.0", nodes }), {});
    }
  });
  it("leaves out nodes that are not objects", () => {
    assert.deepEqual(
      nodesOf({ nodes: { q1: G.nodes.q1, a: null, b: "x", c: [] } }),
      { q1: G.nodes.q1 },
    );
  });
  it("gives a from that is not a list no parents", () => {
    const f1 = { step: "figure", from: "q1" };
    assert.deepEqual(nodesOf({ nodes: { q1: G.nodes.q1, f1 } }), {
      q1: G.nodes.q1,
      f1: { step: "figure", from: [] },
    });
    assert.equal(f1.from, "q1");
  });
});

describe("copyText", () => {
  // A fake execCopy that records what it was asked to copy.
  const fallback = (result) => {
    const calls = [];
    const execCopy = (text) => {
      calls.push(text);
      if (result instanceof Error) throw result;
      return result;
    };
    return { calls, execCopy };
  };
  const refuses = { writeText: async () => Promise.reject(new Error("no")) };
  it("is true when the clipboard takes the text", async () => {
    const { calls, execCopy } = fallback(false);
    const clipboard = { writeText: async () => {} };
    assert.equal(await copyText("select 1", { clipboard, execCopy }), true);
    assert.deepEqual(calls, []);
  });
  it("is false when the clipboard and the fallback both fail", async () => {
    const { execCopy } = fallback(false);
    assert.equal(
      await copyText("select 1", { clipboard: refuses, execCopy }),
      false,
    );
  });
  it("falls back when the clipboard refuses", async () => {
    const { calls, execCopy } = fallback(true);
    assert.equal(
      await copyText("select 1", { clipboard: refuses, execCopy }),
      true,
    );
    assert.deepEqual(calls, ["select 1"]);
  });
  it("falls back when there is no clipboard", async () => {
    for (const clipboard of [undefined, {}]) {
      const { execCopy } = fallback(true);
      assert.equal(await copyText("select 1", { clipboard, execCopy }), true);
    }
  });
  it("is false when the fallback throws", async () => {
    const { execCopy } = fallback(new Error("blocked"));
    assert.equal(
      await copyText("select 1", { clipboard: undefined, execCopy }),
      false,
    );
  });
});

describe("fromReport", () => {
  const d = data();
  it("ignores anything that is not a bridge message", () => {
    for (const m of [
      null,
      "select",
      5,
      {},
      { type: "select", id: "f1" },
      { lineage: "paint" },
    ]) {
      assert.equal(fromReport(d, m), null, JSON.stringify(m));
    }
  });
  it("reads a click on a bound element", () => {
    assert.deepEqual(fromReport(d, { lineage: "select", id: "f1" }), {
      type: "select",
      id: "f1",
    });
  });
  it("ignores a select for an id not in the graph", () => {
    for (const id of [
      "nope",
      "constructor",
      "__proto__",
      "toString",
      5,
      ["f1"],
    ]) {
      assert.equal(fromReport(d, { lineage: "select", id }), null, String(id));
    }
  });
  it("ignores a select when the graph has no nodes", () => {
    const m = { lineage: "select", id: "f1" };
    assert.equal(fromReport({ ...d, graph: null }, m), null);
    assert.equal(fromReport({ ...d, graph: { nodes: 5 } }, m), null);
  });
  it("reads Escape in the report as back", () => {
    assert.deepEqual(fromReport(d, { lineage: "back" }), { type: "back" });
  });
  it("reads how many places each node has on the page", () => {
    const counts = { f1: 2, v1: 1 };
    assert.deepEqual(fromReport(d, { lineage: "ready", counts }), {
      type: "ready",
      counts,
    });
  });
  it("keeps only counts of known nodes that are whole and positive", () => {
    const counts = {
      f1: 2,
      nope: 1,
      constructor: 1,
      f3: "2",
      v1: 0,
      i1: 1.5,
      q1: -1,
    };
    assert.deepEqual(fromReport(d, { lineage: "ready", counts }), {
      type: "ready",
      counts: { f1: 2 },
    });
  });
  it("reads ready with no usable counts as none", () => {
    for (const counts of [undefined, null, 5, []]) {
      assert.deepEqual(fromReport(d, { lineage: "ready", counts }), {
        type: "ready",
        counts: {},
      });
    }
  });
});

describe("nodeState", () => {
  it("gives the node's trace state", () => {
    const d = data({ trace: { q1: "full", x1: "partial" } });
    assert.equal(nodeState(d, "q1"), "full");
    assert.equal(nodeState(d, "x1"), "partial");
  });
  it("calls a node with no trace state partial", () => {
    assert.equal(nodeState(data({ trace: {} }), "f1"), "partial");
  });
  it("calls an id that is not in the graph ungrounded", () => {
    assert.equal(nodeState(data(), "f9"), "ungrounded");
  });
});

describe("title", () => {
  it("uses a figure's label", () => {
    assert.equal(title(G, "f3"), "Margin");
  });
  it("uses an insight's text", () => {
    assert.equal(title(G, "i1"), "Margin was 8.");
  });
  it("uses a view's leading SQL comment", () => {
    assert.equal(title(G, "v1"), "Daily sales");
  });
  it("falls back to a view's visual when its SQL has no comment", () => {
    assert.equal(title(G, "v2"), "bar");
  });
  it("calls a view with no comment and no visual a view", () => {
    const graph = {
      nodes: { v9: { step: "view", from: [], sql: "select 1" } },
    };
    assert.equal(title(graph, "v9"), "view");
  });
  it("uses a sql source's mart, and an external source's ref", () => {
    assert.equal(title(G, "q1"), "marts.sales");
    assert.equal(title(G, "x1"), "targets.csv");
  });
  it("says when an id is not in the graph", () => {
    assert.equal(title(G, "f9"), "Not in the graph");
  });
});

// A row's key: the path from below the clicked step to the row.
const k = (...ids) => JSON.stringify(ids);
// One row of the outline, as `outline` returns it.
const row = (id, key = k(id), loop = false) => ({ id, key, loop });
// Two figures built on each other.
const CYCLE = {
  nodes: {
    f3: { step: "figure", from: ["f4"], expr: "f4 + 1" },
    f4: { step: "figure", from: ["f3"], expr: "f3 * 2" },
  },
};
// The same, with f5 built on the loop.
const ABOVE = {
  nodes: { ...CYCLE.nodes, f5: { step: "figure", from: ["f3"], expr: "f3" } },
};
const up = true;
// Ids bound on a fixture's page, as the report frame reports them.
const boundOn = (d) => readPage(d.html).bindings.map((b) => b.id);

describe("outline", () => {
  it("gives a source no rows", () => {
    assert.deepEqual(outline(G, ["q1"]), { label: null, rows: [] });
  });
  it("gives a step's one input as a row", () => {
    assert.deepEqual(outline(G, ["v1"]), {
      label: "Rests on",
      rows: [row("q1")],
    });
  });
  it("gives several inputs in from order, and counts them", () => {
    assert.deepEqual(outline(G, ["f3"]), {
      label: "Rests on 2",
      rows: [row("f2"), row("f1")],
    });
  });
  it("keys a row by the branch below the clicked step", () => {
    assert.deepEqual(outline(G, ["f3", "f1", "v1"]), {
      label: "Rests on",
      rows: [row("q1", k("f1", "v1", "q1"))],
    });
  });
  it("marks an input that is the clicked step as a loop", () => {
    assert.deepEqual(outline(CYCLE, ["f3", "f4"]), {
      label: "Rests on",
      rows: [row("f3", k("f4", "f3"), true)],
    });
  });
  it("marks an input already higher on the branch as a loop", () => {
    assert.deepEqual(outline(ABOVE, ["f5", "f3", "f4"]), {
      label: "Rests on",
      rows: [row("f3", k("f3", "f4", "f3"), true)],
    });
  });
  it("keeps an input missing from the graph as a row with nothing under it", () => {
    assert.deepEqual(outline(G, ["f7"]), {
      label: "Rests on 2",
      rows: [row("f1"), row("f9")],
    });
    assert.deepEqual(outline(G, ["f7", "f9"]), { label: null, rows: [] });
  });
  it("treats a from that is not a list as no inputs", () => {
    const graph = { nodes: { f1: { step: "figure", from: "q1" } } };
    assert.deepEqual(outline(graph, ["f1"]), { label: null, rows: [] });
  });
  it("gives an input named twice in from one row", () => {
    const graph = {
      nodes: {
        v1: { step: "view", from: [] },
        f1: { step: "figure", from: ["v1", "v1"] },
      },
    };
    assert.deepEqual(outline(graph, ["f1"]), {
      label: "Rests on",
      rows: [row("v1")],
    });
    assert.deepEqual(outline(graph, ["v1"], { up }), {
      label: "Used by",
      rows: [row("f1")],
    });
  });
  it("keys a path apart from an id with a space in it", () => {
    const graph = {
      nodes: {
        a: { step: "view", from: ["b"] },
        b: { step: "source" },
        "a b": { step: "source" },
        f1: { step: "figure", from: ["a", "a b"] },
      },
    };
    const keys = outlineKeys(graph, "f1");
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("outline up", () => {
  it("gives a step nothing uses no rows", () => {
    assert.deepEqual(outline(G, ["i1"], { up }), { label: null, rows: [] });
  });
  it("gives the one step that uses it as a row", () => {
    assert.deepEqual(outline(G, ["f3"], { up }), {
      label: "Used by",
      rows: [row("i1")],
    });
  });
  it("gives several users in graph order, and counts them", () => {
    assert.deepEqual(outline(G, ["v1"], { up }), {
      label: "Used by 3",
      rows: [row("v2"), row("f1"), row("f5")],
    });
  });
  it("keys and marks loops the same way going up", () => {
    assert.deepEqual(outline(G, ["v1", "f1"], { up }), {
      label: "Used by 3",
      rows: [
        row("f3", k("f1", "f3")),
        row("f6", k("f1", "f6")),
        row("f7", k("f1", "f7")),
      ],
    });
    assert.deepEqual(outline(CYCLE, ["f3", "f4"], { up }), {
      label: "Used by",
      rows: [row("f3", k("f4", "f3"), true)],
    });
  });
  it("does not count a from that is not a list as a use", () => {
    const graph = {
      nodes: {
        q1: { step: "source" },
        f1: { step: "figure", from: "q1" },
      },
    };
    assert.deepEqual(outline(graph, ["q1"], { up }), {
      label: null,
      rows: [],
    });
  });
});

describe("outlineKeys", () => {
  it("opens nothing under a source", () => {
    assert.deepEqual(outlineKeys(G, "q1"), []);
  });
  it("gives every row below, depth first in from order", () => {
    assert.deepEqual(outlineKeys(G, "f3"), [
      k("f2"),
      k("f2", "q2"),
      k("f1"),
      k("f1", "v1"),
      k("f1", "v1", "q1"),
    ]);
  });
  it("opens a step reached twice in both branches", () => {
    assert.deepEqual(outlineKeys(G, "f6"), [
      k("f1"),
      k("f1", "v1"),
      k("f1", "v1", "q1"),
      k("f5"),
      k("f5", "v1"),
      k("f5", "v1", "q1"),
    ]);
  });
  it("leaves out a loop row", () => {
    assert.deepEqual(outlineKeys(CYCLE, "f3"), [k("f4")]);
    assert.deepEqual(outlineKeys(ABOVE, "f5"), [k("f3"), k("f3", "f4")]);
  });
  it("opens an input missing from the graph", () => {
    assert.deepEqual(outlineKeys(G, "f7"), [
      k("f1"),
      k("f1", "v1"),
      k("f1", "v1", "q1"),
      k("f9"),
    ]);
  });
});

describe("ownCard", () => {
  it("shows a figure's own card", () => {
    assert.equal(ownCard(G, "f3"), true);
  });
  it("shows no card for a claim that rests on something", () => {
    assert.equal(ownCard(G, "i1"), false);
  });
  it("shows the card of a claim with nothing behind it", () => {
    assert.equal(ownCard(G, "i2"), true);
  });
});

describe("inputRow", () => {
  it("gives an input's kind, title, value and the sources it ends at", () => {
    assert.deepEqual(inputRow(data(), "f1"), {
      id: "f1",
      kind: "Figure",
      title: "Sales",
      value: "12",
      onPage: false,
      ends: ["marts.sales"],
      note: null,
    });
  });
  it("says when the input is on the page", () => {
    assert.equal(inputRow(data(), "f1", { onPage: ["f1"] }).onPage, true);
  });
  it("lists every source under it in graph order, external by its file", () => {
    assert.deepEqual(inputRow(data(), "f3").ends, [
      "marts.sales",
      "marts.costs",
    ]);
    assert.deepEqual(inputRow(data(), "f4").ends, ["targets.csv"]);
    assert.deepEqual(inputRow(data(), "q1"), {
      id: "q1",
      kind: "Source",
      title: "marts.sales",
      value: null,
      onPage: false,
      ends: ["marts.sales"],
      note: null,
    });
  });
  it("says when an input is not in the graph", () => {
    assert.deepEqual(inputRow(data(), "f9"), {
      id: "f9",
      kind: "Missing",
      title: null,
      value: null,
      onPage: false,
      ends: [],
      note: "not in the graph",
    });
  });
  it("says when there is nothing behind an input", () => {
    assert.deepEqual(inputRow(data(), "i2"), {
      id: "i2",
      kind: "Claim",
      title: "Margins will rise.",
      value: null,
      onPage: false,
      ends: [],
      note: "nothing behind it",
    });
  });
});

describe("stepText", () => {
  it("gives nothing for an id not in the graph", () => {
    assert.deepEqual(stepText(G, "f9"), { desc: null, note: null, show: null });
  });
  it("gives a view its desc, with its SQL closed", () => {
    const graph = {
      nodes: { ...G.nodes, v1: { ...G.nodes.v1, desc: "Daily sales totals" } },
    };
    assert.deepEqual(stepText(graph, "v1"), {
      desc: "Daily sales totals",
      note: null,
      show: { label: "SQL", open: false },
    });
  });
  it("opens the SQL of a step with no desc", () => {
    assert.deepEqual(stepText(G, "v1"), {
      desc: null,
      note: null,
      show: { label: "SQL", open: true },
    });
  });

  const withV1 = (over) => ({
    nodes: { ...G.nodes, v1: { ...G.nodes.v1, ...over } },
  });
  it("treats a blank or non-string desc as none", () => {
    for (const desc of [" ", 7]) {
      assert.deepEqual(stepText(withV1({ desc }), "v1"), {
        desc: null,
        note: null,
        show: { label: "SQL", open: true },
      });
    }
  });
  it("labels the toggle with the word the panel prints", () => {
    assert.deepEqual(stepText(G, "v1").show, { label: "SQL", open: true });
    assert.deepEqual(stepText(G, "q1").show, {
      label: "query",
      open: true,
    });
  });

  it("gives an expression figure no toggle; its formula is shown instead", () => {
    assert.equal(stepText(G, "f3").show, null);
    assert.deepEqual(stepText(G, "f1").show, { label: "SQL", open: true });
  });

  it("shows SQL first for a figure with both sql and expr", () => {
    const graph = {
      nodes: {
        f2: { step: "figure", from: ["v1"], sql: "select 1", expr: "f1 / 3" },
      },
    };
    assert.equal(stepText(graph, "f2").show.label, "SQL");
  });
  it("gives no toggle to a step with no SQL", () => {
    const nothing = {
      nodes: {
        ...G.nodes,
        v9: { step: "view", from: [], ungrounded: true },
        q9: { step: "source", kind: "sql", mart: "m" },
      },
    };
    for (const id of ["x1", "i1", "v9", "q9"]) {
      assert.equal(stepText(nothing, id).show, null, id);
    }
  });

  it("ignores a desc on an external source or an insight", () => {
    for (const id of ["x1", "i1"]) {
      const graph = {
        nodes: { ...G.nodes, [id]: { ...G.nodes[id], desc: "x" } },
      };
      assert.equal(stepText(graph, id).desc, null, id);
    }
  });
  it("gives the transform as a note", () => {
    const graph = {
      nodes: {
        ...G.nodes,
        v1: { ...G.nodes.v1, transform: "Excluded the test-market week" },
      },
    };
    assert.equal(stepText(graph, "v1").note, "Excluded the test-market week");
  });
});

// G with one node changed.
const withNode = (id, over) => ({
  nodes: { ...G.nodes, [id]: { ...G.nodes[id], ...over } },
});

describe("stepHead", () => {
  it("gives a missing id only its kind word", () => {
    assert.deepEqual(stepHead(G, "f9"), {
      kind: "Missing",
      title: null,
      sub: null,
      value: null,
    });
  });

  it("titles a view by its desc", () => {
    const g = withNode("v1", { desc: "Daily sales totals" });
    assert.deepEqual(stepHead(g, "v1"), {
      kind: "View",
      title: "Daily sales totals",
      sub: null,
      value: null,
    });
  });

  it("gives a figure its value", () => {
    const g = withNode("f1", { desc: "Sales on the day" });
    assert.deepEqual(stepHead(g, "f1"), {
      kind: "Figure",
      title: "Sales on the day",
      sub: null,
      value: "12",
    });
  });

  it("falls back to the step's name when it has no desc", () => {
    const titles = Object.fromEntries(
      ["f1", "v1", "v2", "i1", "i2"].map((id) => [id, stepHead(G, id).title]),
    );
    assert.deepEqual(titles, {
      f1: "Sales",
      v1: "Daily sales",
      v2: "bar",
      i1: "Margin was 8.",
      i2: "Margins will rise.",
    });
  });

  it("gives no title to a figure with no desc and no label", () => {
    assert.deepEqual(stepHead(G, "f4"), {
      kind: "Figure",
      title: null,
      sub: null,
      value: "10",
    });
  });
  it("titles a sql source by its mart, with its desc under it", () => {
    const g = withNode("q1", { desc: "Sales for each day" });
    assert.deepEqual(stepHead(g, "q1"), {
      kind: "Source",
      title: "marts.sales",
      sub: "Sales for each day",
      value: null,
    });
    assert.equal(stepHead(G, "q1").sub, null);
  });

  it("titles an external source by its ref, with what was given under it", () => {
    const g = withNode("x1", { given: "Q3 targets by channel", desc: "x" });
    assert.deepEqual(stepHead(g, "x1"), {
      kind: "Source",
      title: "targets.csv",
      sub: "Q3 targets by channel",
      value: null,
    });
  });

  it("drops the kind and value on the clicked step, which the head shows", () => {
    const g = withNode("f1", { desc: "Sales on the day" });
    assert.deepEqual(stepHead(g, "f1", { top: true }), {
      kind: null,
      title: "Sales on the day",
      sub: null,
      value: null,
    });
  });

  it("points a clicked step with no desc at its SQL, which is open", () => {
    const head = (title) => ({ kind: null, title, sub: null, value: null });
    for (const id of ["v1", "f1"]) {
      assert.deepEqual(
        stepHead(G, id, { top: true }),
        head("Worked out by the SQL below."),
        id,
      );
    }
    assert.deepEqual(
      stepHead(G, "q1", { top: true }),
      head("Fetched by the query below."),
    );
  });
  it("gives a clicked step with no desc and no SQL no title", () => {
    for (const id of ["f3", "i1", "x1"]) {
      assert.deepEqual(
        stepHead(G, id, { top: true }),
        { kind: null, title: null, sub: null, value: null },
        id,
      );
    }
  });
  it("puts a clicked source's desc or given in the title, not its name", () => {
    const sql = withNode("q1", { desc: "Sales for each day" });
    assert.deepEqual(stepHead(sql, "q1", { top: true }), {
      kind: null,
      title: "Sales for each day",
      sub: null,
      value: null,
    });
    const ext = withNode("x1", { given: "Q3 targets by channel" });
    assert.deepEqual(stepHead(ext, "x1", { top: true }), {
      kind: null,
      title: "Q3 targets by channel",
      sub: null,
      value: null,
    });
  });
});

describe("selection", () => {
  it("gives a figure's id, kind, value and label", () => {
    assert.deepEqual(selection(G, "f1"), {
      id: "f1",
      kind: "Figure",
      value: "12",
      name: "Sales",
    });
    assert.equal(selection(G, "f4").name, null);
  });
  it("gives any other step its name, and nothing for a missing id", () => {
    assert.deepEqual(selection(G, "v1"), {
      id: "v1",
      kind: "View",
      value: null,
      name: "Daily sales",
    });
    assert.deepEqual(selection(G, "x1"), {
      id: "x1",
      kind: "Source",
      value: null,
      name: "targets.csv",
    });
    assert.deepEqual(selection(G, "i1"), {
      id: "i1",
      kind: "Claim",
      value: null,
      name: "Margin was 8.",
    });
    assert.equal(selection(G, "f9"), null);
  });
});

describe("reportCounts", () => {
  it("counts nothing in an empty graph", () => {
    assert.deepEqual(reportCounts(EMPTY), {
      numbers: 0,
      claims: 0,
      views: 0,
      sources: 0,
    });
  });
  it("counts figures, insights, views, and sources with external ones", () => {
    assert.deepEqual(reportCounts(dg()), {
      numbers: 7,
      claims: 2,
      views: 2,
      sources: 3,
    });
  });
  it("counts each bare number check found as a number", () => {
    const d = withIssues([C2("i1", "1,240"), C2(null, "30")]);
    assert.deepEqual(reportCounts(d), {
      numbers: 9,
      claims: 2,
      views: 2,
      sources: 3,
    });
  });
  it("skips a node of an unknown step or one that is not an object", () => {
    const d = data({ graph: { nodes: { m1: { step: "metric" }, z: 7 } } });
    assert.deepEqual(reportCounts(d), {
      numbers: 0,
      claims: 0,
      views: 0,
      sources: 0,
    });
  });
});

describe("stepFacts", () => {
  it("gives nothing for an id not in the graph", () => {
    assert.equal(stepFacts(dg(), "f9"), null);
  });
  it("gives a sql source's mart, period, how and columns", () => {
    const d = data({
      graph: {
        nodes: {
          q1: {
            step: "source",
            kind: "sql",
            how: "captured",
            mart: "marts.sales",
            period: AUG,
            columns: ["day", "amount"],
          },
        },
      },
    });
    assert.deepEqual(stepFacts(d, "q1"), {
      kind: "sql",
      mart: "marts.sales",
      period: AUG,
      pinned: true,
      how: "captured",
      columns: ["day", "amount"],
    });
  });

  it("calls a sql source with a C7 not pinned, and fills what is missing", () => {
    const d = withIssues([
      issue("C7", "q1", "SQL uses date functions: current_date"),
    ]);
    assert.deepEqual(stepFacts(d, "q1"), {
      kind: "sql",
      mart: "marts.sales",
      period: null,
      pinned: false,
      how: null,
      columns: [],
    });
  });

  it("calls a source pinned when its only C7 is about columns", () => {
    const d = withIssues([
      issue("C7", "q1", "sql source is missing `columns`"),
    ]);
    assert.equal(stepFacts(d, "q1").pinned, true);
  });

  it("gives an external source's ref and what was given", () => {
    assert.deepEqual(stepFacts(dg(), "x1"), {
      kind: "external",
      ref: "targets.csv",
      given: null,
      columns: [],
    });
    const given = "Q3 targets by channel";
    const d = dg({
      graph: { nodes: { ...G.nodes, x1: { ...G.nodes.x1, given } } },
    });
    assert.equal(stepFacts(d, "x1").given, given);
  });

  it("gives a view's parents, columns and visual", () => {
    assert.deepEqual(stepFacts(dg(), "v1"), {
      kind: "view",
      from: ["q1"],
      columns: [],
      visual: "table",
    });
  });

  it("gives a sql figure's value, label and what it picks from", () => {
    assert.deepEqual(stepFacts(dg(), "f1"), {
      kind: "pick",
      value: "12",
      label: "Sales",
      from: ["v1"],
    });
  });

  it("falls back to the value when a figure has no display", () => {
    const f8 = { step: "figure", from: ["v1"], sql: "select 1", value: 0.5 };
    const at = (node) =>
      stepFacts(dg({ graph: { nodes: { ...G.nodes, f8: node } } }), "f8");
    const first = at(f8);
    assert.equal(first.value, "0.5");
    assert.equal(first.label, null);
    assert.equal(at({ ...f8, value: undefined }).value, null);
  });

  it("gives an expression figure's value, label and expression", () => {
    assert.deepEqual(stepFacts(dg(), "f3"), {
      kind: "formula",
      value: "8",
      label: "Margin",
      expr: "f1 - f2",
    });
  });

  it("gives a figure with both sql and expr as a pick", () => {
    const node = {
      step: "figure",
      from: ["v1"],
      sql: "select 1",
      expr: "f1 / 3",
      value: 1,
    };
    const d = dg({ graph: { nodes: { ...G.nodes, f8: node } } });
    assert.equal(stepFacts(d, "f8").kind, "pick");
  });

  it("gives a claim's text and what it rests on", () => {
    assert.deepEqual(stepFacts(dg(), "i1"), {
      kind: "claim",
      text: "Margin was 8.",
      from: ["f3"],
    });
  });
});

describe("highlightSql", () => {
  it("escapes text that is not a keyword", () => {
    assert.equal(highlightSql("a < b & c"), "a &lt; b &amp; c");
  });
  it("marks keywords", () => {
    assert.equal(
      highlightSql("select x from t"),
      '<span class="kw">select</span> x <span class="kw">from</span> t',
    );
  });
  it("marks keywords in any case, keeping the case", () => {
    assert.equal(highlightSql("SELECT x"), '<span class="kw">SELECT</span> x');
  });
  it("marks a string, with no keywords inside it", () => {
    assert.equal(
      highlightSql("where d = 'select'"),
      '<span class="kw">where</span> d = <span class="str">\'select\'</span>',
    );
  });
  it("marks a comment to the end of its line, and whole numbers", () => {
    assert.equal(
      highlightSql("-- from q1\nselect 1"),
      '<span class="cm">-- from q1</span>\n<span class="kw">select</span> <span class="num">1</span>',
    );
  });
});

describe("reportSql", () => {
  it("copies the composed report", () => {
    assert.deepEqual(
      reportSql(data({ composedReport: "-- r.html\nselect 1" })),
      { sql: "-- r.html\nselect 1", reason: null },
    );
  });
  it("is off with sql's reason when the report fails check", () => {
    assert.deepEqual(reportSql(data({ refused: REFUSED })), {
      sql: null,
      reason: REFUSED,
    });
  });
});

describe("chainSql", () => {
  it("copies the one-node script", () => {
    assert.deepEqual(
      chainSql(data({ composed: { f1: "-- r.html (f1)\nselect 1" } }), "f1"),
      { sql: "-- r.html (f1)\nselect 1", reason: null },
    );
  });
  it("is off when there is nothing to run", () => {
    assert.deepEqual(chainSql(data({ composed: { f1: "…" } }), "x1"), {
      sql: null,
      reason: "Nothing here to run",
    });
  });
  it("is off with sql's reason when the report fails check", () => {
    assert.deepEqual(chainSql(data({ refused: REFUSED }), "f1"), {
      sql: null,
      reason: REFUSED,
    });
  });
});

describe("stepSql", () => {
  it("copies the step's own SQL", () => {
    assert.deepEqual(stepSql(data(), "v1"), {
      sql: G.nodes.v1.sql,
      reason: null,
    });
  });
  it("is off with sql's reason when the report fails check", () => {
    assert.deepEqual(stepSql(data({ refused: REFUSED }), "v1"), {
      sql: null,
      reason: REFUSED,
    });
  });
});

describe("tidyExpr", () => {
  it("spaces arithmetic and writes − and ×", () => {
    assert.equal(tidyExpr("(f1-f2)/f2"), "(f1 − f2) / f2");
    assert.equal(tidyExpr("f1*100"), "f1 × 100");
    assert.equal(tidyExpr("f1 + f2"), "f1 + f2");
  });

  it("tidies arithmetic inside a function call", () => {
    assert.equal(tidyExpr("round(f1*100, 1)"), "round(f1 × 100, 1)");
  });

  it("shows any other SQL as written", () => {
    const sql = "case when f1 > f2 then 'up-tick' else f2 * 2 end";
    assert.equal(tidyExpr(sql), sql);
  });

  it("keeps the sign of an exponent with its number", () => {
    assert.equal(tidyExpr("f1*1e-3+2.5E+2"), "f1 × 1e-3 + 2.5E+2");
  });
});

describe("isArithmetic", () => {
  it("is true for numbers, ids and + - * / in brackets", () => {
    assert.equal(isArithmetic("(f1 - f2) / f2 * 100"), true);
  });

  it("is false for any other SQL", () => {
    assert.equal(isArithmetic("round(f1, 1)"), false);
    assert.equal(isArithmetic("case when f1 > 0 then f1 end"), false);
  });
});

describe("exprParts", () => {
  const isId = (t) => t === "f1" || t === "f2";

  it("splits the tidied text into ids and plain text", () => {
    assert.deepEqual(exprParts("(f1-f2)/f2", isId), [
      { text: "(" },
      { id: "f1" },
      { text: " − " },
      { id: "f2" },
      { text: ") / " },
      { id: "f2" },
    ]);
  });

  it("keeps quoted text and function names as plain text", () => {
    assert.deepEqual(
      exprParts(`case when f1 > 0 then 'f2' else f2("f1") end`, isId),
      [
        { text: "case when " },
        { id: "f1" },
        { text: " > 0 then 'f2' else f2(\"f1\") end" },
      ],
    );
  });
});

describe("lineage: fixtures", () => {
  it("outlines clean's 11.8%", () => {
    const d = fx("clean");
    assert.equal(ownCard(d.graph, "f3"), true);
    assert.deepEqual(outline(d.graph, ["f3"]), {
      label: "Rests on 2",
      rows: [row("f1"), row("f2")],
    });
    assert.deepEqual(outlineKeys(d.graph, "f3"), [
      k("f1"),
      k("f1", "v1"),
      k("f1", "v1", "q1"),
      k("f2"),
      k("f2", "v1"),
      k("f2", "v1", "q1"),
    ]);
  });
  it("gives every step of clean a desc, with its SQL closed", () => {
    const d = fx("clean");
    for (const [id, node] of Object.entries(d.graph.nodes)) {
      if (node.step === "insight") continue;
      const { desc, show } = stepText(d.graph, id);
      assert.equal(typeof desc, "string", id);
      assert.ok(desc.length > 0 && [...desc].length <= 120, id);
      assert.ok(!desc.includes("\n"), id);
      if (show !== null) assert.equal(show.open, false, id);
    }
    assert.equal(stepText(d.graph, "f3").show, null);
  });
  it("opens the SQL of messy's step with no desc, and keeps a long desc whole", () => {
    const d = fx("messy");
    assert.deepEqual(stepText(d.graph, "v2"), {
      desc: null,
      note: null,
      show: { label: "SQL", open: true },
    });
    assert.equal(
      stepText(d.graph, "f4").desc,
      "Counts every site session in the web sessions mart over the 30 days before the report ran, across all channels, devices and landing pages",
    );
  });
  it("copies clean's SQL as htmlineage sql does", () => {
    const d = fx("clean");
    assert.equal(reportSql(d).sql, CLEAN_SQL);
    assert.equal(chainSql(d, "f3").sql, CLEAN_F3_SQL);
  });
  it("turns off every copy button on broken", async () => {
    const d = fx("broken");
    const off = { sql: null, reason: d.refused };
    const printed = await runCli(["sql", loadFixture("broken").reportPath]);
    assert.equal(`htmlineage: ${d.refused}`, printed.err);
    assert.deepEqual(reportSql(d), off);
    for (const [id, node] of Object.entries(d.graph.nodes)) {
      assert.deepEqual(chainSql(d, id), off, id);
      if (node.sql) assert.deepEqual(stepSql(d, id), off, id);
    }
  });
  it("gives clean a calm reviewer view", () => {
    const d = fx("clean");
    assert.deepEqual(headline(grounding(d)), {
      numbers: "All 6 numbers trace to the warehouse.",
      claims: "All 3 claims are supported.",
    });
    assert.deepEqual(mismatches(d), []);
    assert.deepEqual(untraced(d), []);
    assert.deepEqual(checkStatus(d), {
      line: "check · clean",
      issues: [],
      reason: null,
    });
  });
  it("says what clean is built on", () => {
    const d = fx("clean");
    const q1 = {
      node: "q1",
      kind: "sql",
      name: "marts.retention_by_channel",
      period: { from: "2026-01-01", to: "2026-08-31" },
      pinned: true,
      numbers: 6,
    };
    assert.deepEqual(builtOn(d), [
      q1,
      {
        node: "q2",
        kind: "sql",
        name: "marts.acquisition_by_channel",
        period: AUG,
        pinned: true,
        numbers: 2,
      },
    ]);
    assert.deepEqual(builtFrom(d, "f3"), [q1]);
  });
  it("gives messy's grounding and what is not traced", () => {
    const d = fx("messy");
    assert.deepEqual(headline(grounding(d)), {
      numbers:
        "2 of 5 numbers trace to the warehouse. 2 rest on a file. 1 has nothing behind it.",
      claims: "1 of 4 claims is supported. 3 are stated without support.",
    });
    assert.deepEqual(untraced(d), [
      { node: "i1", kind: "bare", text: "1,240" },
      {
        node: "i2",
        kind: "claim",
        text: "Industry benchmarks put paid search cost per customer around $50.",
      },
      {
        node: "i3",
        kind: "claim",
        text: "Creative fatigue on the summer campaign is the likely driver.",
      },
      {
        node: "i4",
        kind: "claim",
        text: "Costs should ease in September once the new creative is live.",
      },
    ]);
  });
  it("says what messy is built on, with q2 not pinned", () => {
    const d = fx("messy");
    const q1 = {
      node: "q1",
      kind: "sql",
      name: "marts.acquisition_by_channel",
      period: AUG,
      pinned: true,
      numbers: 2,
    };
    const t1 = {
      node: "t1",
      kind: "external",
      name: "q3-targets.csv",
      numbers: 2,
    };
    assert.deepEqual(builtOn(d), [
      q1,
      {
        node: "q2",
        kind: "sql",
        name: "marts.web_sessions",
        period: AUG,
        pinned: false,
        numbers: 1,
      },
      t1,
    ]);
    assert.deepEqual(builtFrom(d, "f3"), [q1, t1]);
  });
  it("gives messy's mismatch and its status bar", () => {
    const d = fx("messy");
    assert.deepEqual(mismatches(d), [
      { node: "f1", page: ["$58.90"], graph: "$61.20" },
    ]);
    const status = checkStatus(d);
    assert.equal(status.line, "check · 9 notes");
    assert.deepEqual(
      status.issues.map((i) => i.code),
      ["S6", "S5", "S7", "S7", "S9", "C2", "C3", "C7", "C8"],
    );
    assert.equal(status.reason, null);
  });
  it("gives broken's grounding as far as its lineage goes", () => {
    const d = fx("broken");
    assert.deepEqual(headline(grounding(d)), {
      numbers:
        "3 of 5 numbers trace to the warehouse. 2 have nothing behind them.",
      claims: "3 of 4 claims are supported. 1 is stated without support.",
    });
    assert.deepEqual(untraced(d), [
      { node: "f3", kind: "figure", text: "3" },
      { node: "f4", kind: "figure", text: "2" },
      {
        node: "i1",
        kind: "claim",
        text: "Monthly subscribers are the churn problem.",
      },
    ]);
    assert.deepEqual(builtOn(d), [
      {
        node: "q1",
        kind: "sql",
        name: "marts.subscription_churn",
        period: { from: "2026-07-01", to: "2026-08-31" },
        pinned: true,
        numbers: 3,
      },
    ]);
  });
  it("lists broken's errors first in the status bar, with sql's reason", () => {
    const d = fx("broken");
    const status = checkStatus(d);
    assert.equal(status.line, "check · 9 errors · 1 note");
    assert.deepEqual(
      status.issues.map((i) => i.code),
      ["C9", "C4", "S4", "S2", "S3", "C1", "C1", "C5", "C6", "S8"],
    );
    assert.equal(status.reason, d.refused);
  });
  it("lists S1 for a graph the page cannot read", (t) => {
    const dir = tempDir(t);
    for (const text of [
      "null",
      "[]",
      '"x"',
      '{"lineage":"1.0"}',
      '{"lineage":"1.0","nodes":5}',
      '{"lineage":"1.0","nodes":[]}',
    ]) {
      const graphPath = join(dir, "g.json");
      writeFileSync(graphPath, text);
      const d = buildPayload({
        reportPath: loadFixture("clean").reportPath,
        graphPath,
      });
      assert.deepEqual(nodesOf(d.graph), {}, text);
      const status = checkStatus(d);
      assert.deepEqual(
        status.issues.map((i) => i.code),
        ["S1"],
        text,
      );
      assert.equal(status.line, "check · 1 error", text);
      assert.deepEqual(grounding(d), grounding(EMPTY), text);
      assert.deepEqual(builtOn(d), [], text);
      assert.equal(reportSql(d).sql, null, text);
    }
  });
  it("gives every fixture's nodes through nodesOf", () => {
    for (const name of ["clean", "messy", "broken"]) {
      const d = fx(name);
      assert.deepEqual(
        Object.keys(nodesOf(d.graph)),
        Object.keys(d.graph.nodes).filter(
          (id) => d.graph.nodes[id] && typeof d.graph.nodes[id] === "object",
        ),
        name,
      );
    }
  });
  it("selects every bound id on clean", () => {
    const d = fx("clean");
    const ids = [...d.html.matchAll(/data-lineage="([^"]*)"/g)].map(
      (m) => m[1],
    );
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.deepEqual(
        fromReport(d, { lineage: "select", id }),
        { type: "select", id },
        id,
      );
    }
  });
  it("counts what each fixture holds", () => {
    assert.deepEqual(reportCounts(fx("clean")), {
      numbers: 6,
      claims: 3,
      views: 2,
      sources: 2,
    });
    assert.deepEqual(reportCounts(fx("messy")), {
      numbers: 5,
      claims: 4,
      views: 3,
      sources: 3,
    });
    assert.deepEqual(reportCounts(fx("broken")), {
      numbers: 5,
      claims: 4,
      views: 2,
      sources: 1,
    });
  });
  it("gives messy's external source, its undescribed view and its unpinned source", () => {
    const d = fx("messy");
    assert.deepEqual(stepHead(d.graph, "t1"), {
      kind: "Source",
      title: "q3-targets.csv",
      sub: "A CSV of Q3 cost-per-customer targets by channel, shared by the builder",
      value: null,
    });
    assert.deepEqual(stepFacts(d, "t1").columns, [
      "channel",
      "target_cost_per_customer",
    ]);
    assert.deepEqual(stepHead(d.graph, "v2", { top: true }), {
      kind: null,
      title: "Worked out by the SQL below.",
      sub: null,
      value: null,
    });
    assert.equal(stepHead(d.graph, "v2").title, "bar");
    assert.equal(stepFacts(d, "q2").pinned, false);
    assert.equal(builtOn(d).find((r) => r.node === "q2").pinned, false);
    assert.equal(stepText(d.graph, "f3").show, null);
  });
  it("titles each step of clean by its desc, sources by their mart", () => {
    const d = fx("clean");
    for (const [id, node] of Object.entries(d.graph.nodes)) {
      if (node.step === "view" || node.step === "figure") {
        assert.equal(
          stepHead(d.graph, id).title,
          stepText(d.graph, id).desc,
          id,
        );
      }
    }
    assert.deepEqual(stepHead(d.graph, "q1"), {
      kind: "Source",
      title: "marts.retention_by_channel",
      sub: stepText(d.graph, "q1").desc,
      value: null,
    });
  });
  it("outlines clean's claims, down and up", () => {
    const d = fx("clean");
    assert.equal(ownCard(d.graph, "i1"), false);
    assert.deepEqual(outline(d.graph, ["i1"]), {
      label: "Rests on",
      rows: [row("f6")],
    });
    assert.deepEqual(inputRow(d, "f6", { onPage: boundOn(d) }), {
      id: "f6",
      kind: "Figure",
      title: "The channel with the highest retention in August 2026",
      value: "Paid social",
      onPage: true,
      ends: ["marts.retention_by_channel", "marts.acquisition_by_channel"],
      note: null,
    });
    assert.deepEqual(outline(d.graph, ["f1"], { up }), {
      label: "Used by 2",
      rows: [row("f3"), row("i2")],
    });
    assert.deepEqual(outline(d.graph, ["f1", "i2"], { up }), {
      label: "Used by",
      rows: [row("i3", k("i2", "i3"))],
    });
  });
  it("outlines messy's claim and opens f3 under it", () => {
    const d = fx("messy");
    assert.equal(ownCard(d.graph, "i1"), false);
    assert.deepEqual(outline(d.graph, ["i1"]), {
      label: "Rests on 3",
      rows: [row("f1"), row("f2"), row("f3")],
    });
    assert.deepEqual(outline(d.graph, ["i1", "f3"]), {
      label: "Rests on 2",
      rows: [row("f1", k("f3", "f1")), row("f2", k("f3", "f2"))],
    });
    assert.deepEqual(inputRow(d, "f2", { onPage: boundOn(d) }), {
      id: "f2",
      kind: "Figure",
      title:
        "The Q3 cost-per-customer target for paid search, from the targets file",
      value: "$55.00",
      onPage: true,
      ends: ["q3-targets.csv"],
      note: null,
    });
  });
  it("stops broken's loop, both ways", () => {
    const d = fx("broken");
    assert.deepEqual(outline(d.graph, ["f3"]), {
      label: "Rests on",
      rows: [row("f4")],
    });
    const loop = { label: "Rests on", rows: [row("f3", k("f4", "f3"), true)] };
    assert.deepEqual(outline(d.graph, ["f3", "f4"]), loop);
    assert.deepEqual(outline(d.graph, ["f3", "f4"], { up }), {
      ...loop,
      label: "Used by",
    });
    assert.deepEqual(outlineKeys(d.graph, "f3"), [k("f4")]);
    const f4 = inputRow(d, "f4", { onPage: boundOn(d) });
    assert.deepEqual(f4.ends, []);
    assert.equal(f4.note, null);
  });
});
