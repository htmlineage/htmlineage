import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FIELDS, HEADER_FIELDS } from "../src/graph/schema.js";

const FORMAT = new URL("../skill/references/format.md", import.meta.url);

/**
 * The field names in the first table under the `### <heading>` line, sorted.
 * A heading with no table gives an empty list.
 */
function fieldsUnder(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`### ${heading}`);
  if (start === -1) return [];
  const fields = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6} /.test(line)) break;
    if (line.startsWith("|")) {
      inTable = true;
      const name = /^\|\s*`([^`]+)`/.exec(line);
      if (name) fields.push(name[1]);
    } else if (inTable) break;
  }
  return fields.sort();
}

describe("format reference", () => {
  it("reads the field names from the table under a heading", () => {
    const markdown = [
      "### view",
      "",
      "| Field  | Required | Type   | Use        |",
      "| ------ | -------- | ------ | ---------- |",
      '| `step` | required | string | `"view"`   |',
      "| `from` | required | list   | parent ids |",
      "",
      "A second table, not a field table:",
      "",
      "| Case  | Note  |",
      "| ----- | ----- |",
      "| `bad` | extra |",
      "",
      "### empty",
      "",
      "No table here.",
      "",
      "### figure",
      "",
      "| Field  | Required | Type   | Use          |",
      "| ------ | -------- | ------ | ------------ |",
      "| `expr` | optional | string | over figures |",
    ].join("\n");
    assert.deepEqual(fieldsUnder(markdown, "view"), ["from", "step"]);
    assert.deepEqual(fieldsUnder(markdown, "figure"), ["expr"]);
    assert.deepEqual(fieldsUnder(markdown, "empty"), []);
  });

  /** Assert the table under `heading` names exactly `expected`. */
  function assertNames(heading, expected) {
    const named = fieldsUnder(readFileSync(FORMAT, "utf8"), heading);
    const want = [...expected].sort();
    const missing = want.filter((field) => !named.includes(field));
    const extra = named.filter((field) => !want.includes(field));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `format.md ### ${heading}: fields missing from the table, or not in the schema`,
    );
  }

  it("names exactly the fields of a sql source", () => {
    assertNames("sql source", FIELDS.sql);
  });

  it("names exactly the fields of an external source", () => {
    assertNames("external source", FIELDS.external);
  });

  it("names exactly the fields of a view", () => {
    assertNames("view", FIELDS.view);
  });

  it("names exactly the fields of a figure", () => {
    assertNames("figure", FIELDS.figure);
  });

  it("names exactly the fields of an insight", () => {
    assertNames("insight", FIELDS.insight);
  });

  it("names exactly the fields of the graph header", () => {
    assertNames("header", HEADER_FIELDS);
  });
});
