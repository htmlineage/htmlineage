import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exprProblem, exprRefs } from "../src/graph/expr.js";

describe("exprProblem", () => {
  it("reads any SQL text whose brackets and quotes close", () => {
    for (const source of [
      "(f1 - f2) / f2",
      "case when f1 > f2 then f1 else f2 end",
      "greatest(f1, 0) * 100",
      "f1 ^ 2",
      "rank_of(f1)",
      "F1 + f2",
    ]) {
      assert.equal(exprProblem(source), null, source);
    }
  });

  it("points at a ( that is never closed", () => {
    assert.deepEqual(exprProblem("(f1 + f2"), {
      message: "`(` is never closed",
      position: 0,
    });
    assert.deepEqual(exprProblem("round((f1 + f2, 1)"), {
      message: "`(` is never closed",
      position: 5,
    });
  });

  it("points at a ) with no matching (", () => {
    assert.deepEqual(exprProblem("f1 + f2)"), {
      message: "`)` has no matching `(`",
      position: 7,
    });
  });

  it("points at a single quote that is never closed", () => {
    assert.deepEqual(exprProblem("case when f1 > 0 then 'up end"), {
      message: "`'` is never closed",
      position: 22,
    });
  });

  it("reads brackets and doubled quotes inside a string as text", () => {
    for (const source of [
      "case when f1 > 0 then ')' end",
      "case when f1 > 0 then 'it''s (' end",
    ]) {
      assert.equal(exprProblem(source), null, source);
    }
  });

  it("points at a double quote that is never closed", () => {
    assert.deepEqual(exprProblem('"f1 + f2'), {
      message: '`"` is never closed',
      position: 0,
    });
  });

  it("points at a comment and sends the note to label", () => {
    assert.deepEqual(exprProblem("f1 * 2 -- doubled"), {
      message: "`--` starts a comment; put notes in the node's `label`",
      position: 7,
    });
    assert.deepEqual(exprProblem("f1 /* x */ * 2"), {
      message: "`/*` starts a comment; put notes in the node's `label`",
      position: 3,
    });
    assert.equal(exprProblem("case when f1 > 0 then '--' end"), null);
  });
});

describe("exprRefs", () => {
  it("lists each node named, once, in first-seen order", () => {
    assert.deepEqual(exprRefs("(f1 - f2) / f2", ["f1", "f2"]), ["f1", "f2"]);
  });

  it("skips words that name no node", () => {
    assert.deepEqual(
      exprRefs("greatest(f1, scale) * F2 + f1_rate", ["f1", "f2"]),
      ["f1"],
    );
  });

  it("skips a function call whose name matches a node", () => {
    assert.deepEqual(exprRefs("f1(f2) + f1 (3)", ["f1", "f2"]), ["f2"]);
  });

  it("skips words inside quotes", () => {
    assert.deepEqual(
      exprRefs(`case when f1 > 0 then 'f2' else "f2" end`, ["f1", "f2"]),
      ["f1"],
    );
  });
});
