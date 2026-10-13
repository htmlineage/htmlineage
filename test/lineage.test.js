import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { writeFileSync } from "node:fs";
import { join } from "node:path";

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
  beats,
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
  trailline: "1.0",
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
  "r.html does not pass `trailline check`, so no script was composed";
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
      assert.deepEqual(nodesOf({ trailline: "1.0", nodes }), {});
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
      { trailline: "paint" },
    ]) {
      assert.equal(fromReport(d, m), null, JSON.stringify(m));
    }
  });
  it("reads a click on a bound element", () => {
    assert.deepEqual(fromReport(d, { trailline: "select", id: "f1" }), {
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
      assert.equal(
        fromReport(d, { trailline: "select", id }),
        null,
        String(id),
      );
    }
  });
  it("ignores a select when the graph has no nodes", () => {
    const m = { trailline: "select", id: "f1" };
    assert.equal(fromReport({ ...d, graph: null }, m), null);
    assert.equal(fromReport({ ...d, graph: { nodes: 5 } }, m), null);
  });
  it("reads Escape in the report as back", () => {
    assert.deepEqual(fromReport(d, { trailline: "back" }), { type: "back" });
  });
  it("reads how many places each node has on the page", () => {
    const counts = { f1: 2, v1: 1 };
    assert.deepEqual(fromReport(d, { trailline: "ready", counts }), {
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
    assert.deepEqual(fromReport(d, { trailline: "ready", counts }), {
      type: "ready",
      counts: { f1: 2 },
    });
  });
  it("reads ready with no usable counts as none", () => {
    for (const counts of [undefined, null, 5, []]) {
      assert.deepEqual(fromReport(d, { trailline: "ready", counts }), {
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

describe("beats", () => {
  it("puts a source alone at step 1", () => {
    assert.deepEqual(beats(G, "q1"), [{ n: 1, ids: ["q1"] }]);
  });
  it("puts a view above its source", () => {
    assert.deepEqual(beats(G, "v1"), [
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("stacks a longer chain one step per beat", () => {
    assert.deepEqual(beats(G, "v2"), [
      { n: 3, ids: ["v2"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("sits each node one above its tallest parent, every source at step 1, in graph order", () => {
    assert.deepEqual(beats(G, "f3"), [
      { n: 4, ids: ["f3"] },
      { n: 3, ids: ["f1"] },
      { n: 2, ids: ["v1", "f2"] },
      { n: 1, ids: ["q1", "q2"] },
    ]);
  });
  it("shows a shared ancestor once", () => {
    assert.deepEqual(beats(G, "f6"), [
      { n: 4, ids: ["f6"] },
      { n: 3, ids: ["f1", "f5"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("puts a parent missing from the graph at step 1, after the known ids", () => {
    assert.deepEqual(beats(G, "f7"), [
      { n: 4, ids: ["f7"] },
      { n: 3, ids: ["f1"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1", "f9"] },
    ]);
  });
  it("ends on a cycle, numbering the steps from 1 with no gap", () => {
    const cycle = {
      nodes: {
        f3: { step: "figure", from: ["f4"], expr: "f4 + 1" },
        f4: { step: "figure", from: ["f3"], expr: "f3 * 2" },
      },
    };
    assert.deepEqual(beats(cycle, "f3"), [
      { n: 2, ids: ["f3"] },
      { n: 1, ids: ["f4"] },
    ]);
  });
  it("treats a from that is not a list as no parents", () => {
    const graph = {
      nodes: {
        q1: { step: "source", kind: "sql" },
        f1: { step: "figure", from: "q1" },
        i1: null,
      },
    };
    assert.deepEqual(beats(graph, "f1"), [{ n: 1, ids: ["f1"] }]);
    assert.deepEqual(beats(graph, "i1"), [{ n: 1, ids: ["i1"] }]);
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
  it("lays out clean's 11.8% from q1 at step 1 up to f3", () => {
    assert.deepEqual(beats(fx("clean").graph, "f3"), [
      { n: 4, ids: ["f3"] },
      { n: 3, ids: ["f1", "f2"] },
      { n: 2, ids: ["v1"] },
      { n: 1, ids: ["q1"] },
    ]);
  });
  it("copies clean's SQL as trailline sql does", () => {
    const d = fx("clean");
    assert.equal(reportSql(d).sql, CLEAN_SQL);
    assert.equal(chainSql(d, "f3").sql, CLEAN_F3_SQL);
  });
  it("turns off every copy button on broken", async () => {
    const d = fx("broken");
    const off = { sql: null, reason: d.refused };
    const printed = await runCli(["sql", loadFixture("broken").reportPath]);
    assert.equal(`trailline: ${d.refused}`, printed.err);
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
    assert.equal(status.line, "check · 7 notes");
    assert.deepEqual(
      status.issues.map((i) => i.code),
      ["S6", "S5", "S7", "C2", "C3", "C7", "C8"],
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
      '{"trailline":"1.0"}',
      '{"trailline":"1.0","nodes":5}',
      '{"trailline":"1.0","nodes":[]}',
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
    const ids = [...d.html.matchAll(/data-trailline="([^"]*)"/g)].map(
      (m) => m[1],
    );
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.deepEqual(
        fromReport(d, { trailline: "select", id }),
        { type: "select", id },
        id,
      );
    }
  });
  it("lays out broken's cycle without hanging", () => {
    assert.deepEqual(beats(fx("broken").graph, "f3"), [
      { n: 2, ids: ["f3"] },
      { n: 1, ids: ["f4"] },
    ]);
  });
});
