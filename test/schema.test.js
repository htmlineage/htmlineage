import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readGraph } from "../src/graph/parse.js";
import {
  FIELDS,
  HEADER_FIELDS,
  RULES,
  validateGraph,
} from "../src/graph/schema.js";
import { FIXTURE_NAMES, loadFixture } from "./helpers.js";

const key = ({ code, severity, node }) => `${code} ${severity} ${node}`;

/** The rule codes validateGraph found, as sorted `code severity node` keys. */
function codes(graph) {
  return validateGraph(graph).map(key).sort();
}

/** A copy of `node` without the named fields. */
function without(node, ...fields) {
  const copy = { ...node };
  for (const field of fields) delete copy[field];
  return copy;
}

/** A minimal graph around the given nodes. */
const graphOf = (nodes) => ({ lineage: "1.0", nodes });

const sqlSource = {
  step: "source",
  kind: "sql",
  desc: "Orders placed in January 2026",
  mart: "marts.orders",
  period: { from: "2026-01-01", to: "2026-01-31" },
  sql: "select\n    order_id\nfrom marts.orders",
  columns: ["order_id"],
};
const view = {
  step: "view",
  from: ["q1"],
  desc: "Orders for each customer",
  sql: "select 1",
  columns: ["a"],
};
const figure = {
  step: "figure",
  from: ["v1"],
  desc: "The first order amount",
  sql: "select a from v1",
  value: 1,
  display: "1",
  label: "One",
};

describe("fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} raises exactly the schema issues in expected.json`, () => {
      const { reportPath, expected } = loadFixture(name);
      const { graph } = readGraph({ reportPath });
      const owned = expected.issues.filter((issue) => issue.code in RULES);
      assert.deepEqual(codes(graph), owned.map(key).sort());
    });
  }

  it("every expected severity matches the rule table", () => {
    for (const name of FIXTURE_NAMES) {
      for (const issue of loadFixture(name).expected.issues) {
        if (issue.code in RULES) {
          assert.equal(issue.severity, RULES[issue.code].severity, key(issue));
        }
      }
    }
  });
});

describe("header", () => {
  it("accepts a minimal graph", () => {
    assert.deepEqual(codes(graphOf({})), []);
  });

  it("accepts the reserved signature field", () => {
    assert.deepEqual(codes({ ...graphOf({}), signature: null }), []);
  });

  const bad = {
    "a missing version": [{ nodes: {} }, ["S1 error null"]],
    "a numeric version": [{ lineage: 1, nodes: {} }, ["S1 error null"]],
    "another major version": [{ lineage: "2.0", nodes: {} }, ["S1 error null"]],
    "missing nodes": [{ lineage: "1.0" }, ["S1 error null"]],
    "nodes as a list": [{ lineage: "1.0", nodes: [] }, ["S1 error null"]],
    "a bad built_at": [
      { ...graphOf({}), built_at: "last tuesday" },
      ["S1 error null"],
    ],
    "a date-only built_at": [
      { ...graphOf({}), built_at: "2026-09-16" },
      ["S1 error null"],
    ],
    "an impossible built_at": [
      { ...graphOf({}), built_at: "2026-02-30T00:00:00Z" },
      ["S1 error null"],
    ],
    "an empty report_id": [
      { ...graphOf({}), report_id: "" },
      ["S1 error null"],
    ],
    "an unknown field": [{ ...graphOf({}), title: "x" }, ["S5 warning null"]],
  };
  for (const [what, [graph, expected]] of Object.entries(bad)) {
    it(`flags ${what}`, () => {
      assert.deepEqual(codes(graph), expected);
    });
  }

  it("accepts a built_at with seconds, fractions or an offset", () => {
    for (const built_at of [
      "2026-09-16T14:20Z",
      "2026-09-16T14:20:00.123Z",
      "2026-09-16T14:20:00+05:30",
    ]) {
      assert.deepEqual(codes({ ...graphOf({}), built_at }), []);
    }
  });

  it("accepts a later minor version", () => {
    assert.deepEqual(codes({ lineage: "1.4", nodes: {} }), []);
  });

  for (const input of [null, [], "graph", 42]) {
    it(`does not throw on ${JSON.stringify(input)}`, () => {
      assert.deepEqual(codes(input), ["S1 error null"]);
    });
  }
});

describe("nodes", () => {
  it("accepts well-formed nodes of every step", () => {
    const graph = graphOf({
      q1: sqlSource,
      x1: {
        step: "source",
        kind: "external",
        type: "csv",
        ref: "targets.csv",
        given: "A CSV",
      },
      v1: view,
      f1: figure,
      f2: { ...figure, from: ["f1"], sql: undefined, expr: "f1 * 2" },
      i1: { step: "insight", from: ["f1"], text: "It went up." },
    });
    delete graph.nodes.f2.sql;
    assert.deepEqual(codes(graph), []);
  });

  it("flags an id that is not a lowercase identifier", () => {
    assert.deepEqual(codes(graphOf({ "f-1": figure })), ["S2 error f-1"]);
  });

  it("flags a node that is not an object", () => {
    assert.deepEqual(codes(graphOf({ f1: "46.6%" })), ["S4 error f1"]);
  });

  it("flags a missing or unknown step and checks nothing else", () => {
    assert.deepEqual(codes(graphOf({ f1: { from: 3 } })), ["S3 error f1"]);
    assert.deepEqual(codes(graphOf({ k1: { step: "kpi", junk: 1 } })), [
      "S3 error k1",
    ]);
  });

  it("warns when the id prefix does not match the step", () => {
    assert.deepEqual(codes(graphOf({ v1: figure })), ["S6 warning v1"]);
    assert.deepEqual(
      codes(
        graphOf({
          q9: {
            step: "source",
            kind: "external",
            type: "a",
            ref: "b",
            given: "c",
          },
        }),
      ),
      ["S6 warning q9"],
    );
  });

  it("warns on unknown fields, including ones from another kind", () => {
    assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, ref: "x" } })), [
      "S5 warning q1",
    ]);
  });

  it('says "an" before a step that starts with a vowel', () => {
    const issues = validateGraph(
      graphOf({
        f1: figure,
        i1: { step: "insight", from: ["f1"], text: "Up.", notes: "x" },
      }),
    ).filter((issue) => issue.code === "S5");
    assert.deepEqual(
      issues.map((issue) => issue.message),
      ["unknown field `notes` on an insight"],
    );
  });
});

describe("sources", () => {
  it("needs a known kind", () => {
    assert.deepEqual(codes(graphOf({ q1: { step: "source" } })), [
      "S4 error q1",
    ]);
    assert.deepEqual(codes(graphOf({ q1: { step: "source", kind: "api" } })), [
      "S4 error q1",
    ]);
  });

  it("leaves missing sql-source fields to C7", () => {
    assert.deepEqual(codes(graphOf({ q1: { step: "source", kind: "sql" } })), [
      "S7 warning q1",
    ]);
  });

  it("warns when an external source does not say what it is", () => {
    assert.deepEqual(
      codes(graphOf({ x1: { step: "source", kind: "external" } })),
      ["S7 warning x1", "S7 warning x1", "S7 warning x1"],
    );
  });

  it("treats blank descriptive fields as missing", () => {
    const blank = {
      step: "source",
      kind: "external",
      type: "",
      ref: " ",
      given: "",
    };
    assert.deepEqual(codes(graphOf({ x1: blank })), [
      "S7 warning x1",
      "S7 warning x1",
      "S7 warning x1",
    ]);
  });

  const badSource = {
    "a reversed period": { period: { from: "2026-02-01", to: "2026-01-01" } },
    "an impossible date": { period: { from: "2026-02-30", to: "2026-03-01" } },
    "a period as a string": { period: "2026-01-01:2026-01-31" },
    "an unknown how": { how: "guessed" },
    "columns that are not strings": { columns: [1, 2] },
    "more than ten rows": {
      rows: { order_id: Array.from({ length: 11 }, (_, i) => i) },
    },
    "ragged rows": { rows: { a: [1, 2], b: [1] } },
    "row-shaped rows": { rows: [{ order_id: 1 }] },
  };
  for (const [what, patch] of Object.entries(badSource)) {
    it(`flags ${what}`, () => {
      assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, ...patch } })), [
        "S4 error q1",
      ]);
    });
  }

  it("accepts null rows and up to ten columnar rows", () => {
    assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, rows: null } })), []);
    const rows = { order_id: Array.from({ length: 10 }, (_, i) => i) };
    assert.deepEqual(codes(graphOf({ q1: { ...sqlSource, rows } })), []);
  });
});

describe("views, figures, insights", () => {
  it("needs `from` as a list of ids", () => {
    const noFrom = without(view, "from");
    assert.deepEqual(codes(graphOf({ v1: noFrom })), ["S4 error v1"]);
    assert.deepEqual(codes(graphOf({ v1: { ...view, from: "q1" } })), [
      "S4 error v1",
    ]);
  });

  it("C4: empty `from` is an error unless marked ungrounded", () => {
    assert.deepEqual(codes(graphOf({ v1: { ...view, from: [] } })), [
      "C4 error v1",
    ]);
    assert.deepEqual(
      codes(graphOf({ v1: { ...view, from: [], ungrounded: true } })),
      [],
    );
  });

  it("needs sql on a view, unless it is ungrounded", () => {
    const noSql = without(view, "sql");
    assert.deepEqual(codes(graphOf({ v1: noSql })), ["S4 error v1"]);
    assert.deepEqual(
      codes(graphOf({ v1: { ...noSql, from: [], ungrounded: true } })),
      [],
    );
  });

  it("flags an encoding with an unknown channel", () => {
    assert.deepEqual(
      codes(graphOf({ v1: { ...view, encoding: { x: "a", colour: "b" } } })),
      ["S4 error v1"],
    );
  });

  it("C9: a figure needs exactly one of sql and expr", () => {
    assert.deepEqual(codes(graphOf({ f1: { ...figure, expr: "f2 + 1" } })), [
      "C9 error f1",
    ]);
    const neither = without(figure, "sql");
    assert.deepEqual(codes(graphOf({ f1: neither })), ["C9 error f1"]);
  });

  it("lets an ungrounded figure have neither sql nor expr", () => {
    const neither = without(figure, "sql");
    assert.deepEqual(
      codes(graphOf({ f1: { ...neither, from: [], ungrounded: true } })),
      [],
    );
  });

  it("accepts a SQL expression outside plain arithmetic", () => {
    const base = without(figure, "sql");
    assert.deepEqual(
      validateGraph(
        graphOf({
          f1: { ...base, from: ["f2"], expr: "greatest(f2, 0) * 100" },
        }),
      ),
      [],
    );
  });

  it("S8: warns on an expression it cannot read", () => {
    const base = without(figure, "sql");
    const issueFor = (expr) =>
      validateGraph(graphOf({ f1: { ...base, from: ["f2"], expr } }));
    assert.deepEqual(issueFor("(f2 + 1"), [
      {
        code: "S8",
        severity: "warning",
        node: "f1",
        field: "expr",
        message: "cannot read `(f2 + 1` at character 1: `(` is never closed",
        fix: null,
      },
    ]);
    assert.deepEqual(issueFor("f2 * 2 -- doubled").map(key), ["S8 warning f1"]);
    assert.equal(
      issueFor("f2 * 2 -- doubled")[0].message,
      "cannot read `f2 * 2 -- doubled` at character 8: `--` starts a comment",
    );
  });

  it("describes expr as SQL when it is not a string", () => {
    const base = without(figure, "sql");
    const issues = validateGraph(
      graphOf({ f1: { ...base, from: ["f2"], expr: 5 } }),
    );
    assert.deepEqual(issues.map(key), ["S4 error f1"]);
    assert.equal(
      issues[0].message,
      "`expr` must be a SQL expression over figure ids",
    );
  });

  it("accepts a string value and a null value", () => {
    for (const value of ["paid_social", null]) {
      assert.deepEqual(codes(graphOf({ f1: { ...figure, value } })), []);
    }
  });

  it("flags a value that is neither number nor string", () => {
    assert.deepEqual(codes(graphOf({ f1: { ...figure, value: [1] } })), [
      "S4 error f1",
    ]);
  });

  it("warns on each missing descriptive field of a figure", () => {
    const bare = without(figure, "value", "display", "label", "desc");
    assert.deepEqual(codes(graphOf({ f1: bare })), [
      "S7 warning f1",
      "S7 warning f1",
      "S7 warning f1",
      "S7 warning f1",
    ]);
  });

  it("needs text on an insight", () => {
    assert.deepEqual(
      codes(graphOf({ i1: { step: "insight", from: ["f1"], text: " " } })),
      ["S4 error i1"],
    );
  });

  it("messages name the node's step and the field", () => {
    const [issue] = validateGraph(
      graphOf({ i1: { step: "insight", from: ["f1"] } }),
    );
    assert.equal(issue.field, "text");
    assert.equal(issue.message, "insight is missing `text`");
    assert.equal(issue.fix, "add it: the claim, as text");
  });

  it("says what a missing field should hold", () => {
    const messages = (nodes) =>
      validateGraph(graphOf(nodes))
        .filter((i) => i.code === "S4")
        .map((i) => [i.message, i.fix]);
    assert.deepEqual(messages({ v1: { step: "view", sql: "select 1" } }), [
      ["view is missing `from`", "add it: a list of node ids"],
    ]);
    assert.deepEqual(messages({ q1: { step: "source" } }), [
      ["source is missing `kind`", 'add it: "sql" or "external"'],
    ]);
  });
});

describe("desc", () => {
  const D = "Monthly retention for each channel";

  it("accepts a desc on a sql source, a view and a figure", () => {
    assert.deepEqual(
      codes(
        graphOf({
          q1: { ...sqlSource, desc: D },
          v1: { ...view, desc: D },
          f1: { ...figure, desc: D },
          f2: {
            step: "figure",
            from: ["f1"],
            expr: "f1 * 2",
            value: 2,
            display: "2",
            label: "Two",
            desc: D,
          },
        }),
      ),
      [],
    );
  });

  it("warns when a view has no desc", () => {
    assert.deepEqual(validateGraph(graphOf({ v1: without(view, "desc") })), [
      {
        code: "S7",
        severity: "warning",
        node: "v1",
        field: "desc",
        message:
          "view has no `desc` (what this step computes and how, in words)",
        fix: null,
      },
    ]);
  });

  it("warns when a sql source or a figure has no desc", () => {
    assert.deepEqual(
      codes(
        graphOf({
          q1: without(sqlSource, "desc"),
          f1: without(figure, "desc"),
          f2: {
            step: "figure",
            from: ["f1"],
            expr: "f1 * 2",
            value: 2,
            display: "2",
            label: "Two",
          },
        }),
      ),
      ["S7 warning f1", "S7 warning f2", "S7 warning q1"],
    );
  });

  it("treats a blank desc as missing", () => {
    assert.deepEqual(codes(graphOf({ v1: { ...view, desc: "  " } })), [
      "S7 warning v1",
    ]);
  });

  const external = {
    step: "source",
    kind: "external",
    type: "csv",
    ref: "t.csv",
    given: "Targets",
  };
  const insight = { step: "insight", from: ["f1"], text: "Up." };

  it("wants no desc on an external source or an insight", () => {
    assert.deepEqual(codes(graphOf({ x1: external, i1: insight })), []);
  });

  it("calls a desc on an external source or an insight an unknown field", () => {
    assert.deepEqual(
      codes(
        graphOf({
          x1: { ...external, desc: D },
          i1: { ...insight, desc: D },
        }),
      ),
      ["S5 warning i1", "S5 warning x1"],
    );
  });

  it("wants no desc on an ungrounded view or figure", () => {
    assert.deepEqual(
      codes(
        graphOf({
          v1: { step: "view", from: [], ungrounded: true, columns: ["a"] },
          f1: {
            step: "figure",
            from: [],
            ungrounded: true,
            value: 1,
            display: "1",
            label: "One",
          },
        }),
      ),
      [],
    );
  });

  it("flags a desc that is not text", () => {
    assert.deepEqual(validateGraph(graphOf({ v1: { ...view, desc: 7 } })), [
      {
        code: "S4",
        severity: "error",
        node: "v1",
        field: "desc",
        message: "`desc` must be a string",
        fix: null,
      },
    ]);
  });

  it("accepts a desc of exactly 120 characters", () => {
    assert.deepEqual(
      codes(graphOf({ v1: { ...view, desc: "a".repeat(120) } })),
      [],
    );
  });

  it("warns when a desc is over 120 characters", () => {
    assert.deepEqual(
      validateGraph(graphOf({ v1: { ...view, desc: "a".repeat(121) } })),
      [
        {
          code: "S9",
          severity: "warning",
          node: "v1",
          field: "desc",
          message: "`desc` is 121 characters",
          fix: "keep it to one line of 120 or fewer",
        },
      ],
    );
  });

  it("counts characters, not UTF-16 units", () => {
    assert.deepEqual(
      codes(graphOf({ v1: { ...view, desc: "€📈".repeat(60) } })),
      [],
    );
  });

  it("warns when a desc has a line break", () => {
    assert.deepEqual(
      validateGraph(
        graphOf({
          v1: { ...view, desc: "Monthly retention\nfor each channel" },
        }),
      ),
      [
        {
          code: "S9",
          severity: "warning",
          node: "v1",
          field: "desc",
          message: "`desc` has a line break",
          fix: "keep it to one line of 120 or fewer",
        },
      ],
    );
  });

  it("raises one S9 for a desc that is long and has a line break", () => {
    const issues = validateGraph(
      graphOf({ v1: { ...view, desc: "a".repeat(130) + "\nb" } }),
    );
    assert.deepEqual(issues.map(key), ["S9 warning v1"]);
    assert.match(issues[0].message, /is 132 characters/);
  });

  it("lists S9 in the rule table as a warning", () => {
    assert.deepEqual(RULES.S9, {
      severity: "warning",
      title: "description is too long or not one line",
    });
  });
});

describe("field lists", () => {
  it("lists the fields each kind of node may carry", () => {
    const sorted = Object.fromEntries(
      Object.entries(FIELDS).map(([kind, set]) => [kind, [...set].sort()]),
    );
    assert.deepEqual(sorted, {
      sql: "columns desc how kind mart period rows sql step transform".split(
        " ",
      ),
      external: "columns given kind ref rows step transform type".split(" "),
      view: "columns desc encoding from rows sql step transform ungrounded".split(
        " ",
      ),
      figure:
        "desc display expr from label sql step transform ungrounded value".split(
          " ",
        ),
      insight: "from step text transform ungrounded".split(" "),
    });
  });

  it("lists the fields a graph header may carry", () => {
    assert.deepEqual(
      [...HEADER_FIELDS].sort(),
      "builder_tool built_at lineage nodes report_id signature".split(" "),
    );
  });
});
