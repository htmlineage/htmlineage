import assert from "node:assert/strict";
import { cpSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { findEmbeddedGraph, readGraph } from "../src/graph/parse.js";
import { FIELDS, HEADER_FIELDS } from "../src/graph/schema.js";
import { runCli, tempDir } from "./helpers.js";

const SKILL = new URL("../skills/htmlineage/", import.meta.url);
const FORMAT = new URL(
  "../skills/htmlineage/references/format.md",
  import.meta.url,
);

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

/**
 * The `key: value` pairs between the opening `---` line and the next one.
 * Text that does not start with `---` gives an empty object.
 */
function frontmatter(text) {
  const lines = text.split("\n");
  if (lines[0] !== "---") return {};
  const fields = {};
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    const pair = /^([^:\s]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2];
  }
  return fields;
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

/** The first fenced block under the `## <heading>` line, or null. */
function fencedBlockUnder(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return null;
  const block = [];
  let inBlock = false;
  for (const line of lines.slice(start + 1)) {
    if (!inBlock && line.startsWith("## ")) return null;
    if (line.startsWith("```")) {
      if (inBlock) return block.join("\n");
      inBlock = true;
    } else if (inBlock) block.push(line);
  }
  return null;
}

/** The backticked id that starts each ordered-list item under `## <heading>`. */
function orderedIdsUnder(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return [];
  const ids = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const id = /^\d+\.\s+`([^`]+)`/.exec(line);
    if (id) ids.push(id[1]);
  }
  return ids;
}

const EXAMPLE = fileURLToPath(
  new URL("../skills/htmlineage/references/example/", import.meta.url),
);
const EXAMPLE_REPORT = join(EXAMPLE, "august-retention.html");

describe("worked example", () => {
  it("keeps the graph beside the report, not in it", () => {
    const { origin, path } = readGraph({ reportPath: EXAMPLE_REPORT });
    assert.equal(origin, "sidecar");
    assert.ok(path.endsWith(join(".lineage", "august-retention.json")));
    assert.equal(findEmbeddedGraph(readFileSync(EXAMPLE_REPORT, "utf8")), null);
  });

  it("passes check with no errors and no warnings", async (t) => {
    const copy = tempDir(t);
    cpSync(EXAMPLE, copy, { recursive: true });
    const { code, out, err } = await runCli([
      "check",
      join(copy, "august-retention.html"),
      "--json",
    ]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out).issues, []);
    assert.equal(err, "");
  });

  it("leaves out the fields a model does not write", () => {
    const { graph } = readGraph({ reportPath: EXAMPLE_REPORT });
    assert.deepEqual(Object.keys(graph).sort(), ["lineage", "nodes"]);
    for (const [id, node] of Object.entries(graph.nodes)) {
      assert.ok(!("how" in node), `${id} has a how key`);
    }
  });

  it("shows a given value as an external source and a figure over it", () => {
    const { nodes } = readGraph({ reportPath: EXAMPLE_REPORT }).graph;
    assert.equal(nodes.x1.step, "source");
    assert.equal(nodes.x1.kind, "external");
    assert.equal(typeof nodes.x1.given, "string");
    assert.notEqual(nodes.x1.given.trim(), "");
    assert.deepEqual(nodes.f7.from, ["x1"]);
    assert.equal(typeof nodes.f7.sql, "string");
  });

  it("marks a claim with no source as ungrounded", () => {
    const { nodes } = readGraph({ reportPath: EXAMPLE_REPORT }).graph;
    assert.equal(nodes.i4.ungrounded, true);
    assert.deepEqual(nodes.i4.from, []);
  });

  it("keeps the patterns it shares with clean", () => {
    const { v1, f3, f4, f5, f6, i3 } = readGraph({
      reportPath: EXAMPLE_REPORT,
    }).graph.nodes;
    assert.ok(v1.columns.includes("retention_rank"));
    assert.ok(v1.sql.includes("rank() over"));
    assert.deepEqual(f4.from, ["v1"]);
    assert.ok(f4.sql.includes("retention_rank"));
    assert.ok(f5.sql.includes("from ("));
    assert.equal(typeof f6.value, "string");
    assert.equal(typeof f3.expr, "string");
    assert.equal(f3.sql, undefined);
    assert.ok(i3.from.includes("i2"));
  });

  it("reads the first fenced block under a heading", () => {
    const markdown = [
      "## Prompt",
      "",
      "```",
      "not this one",
      "```",
      "",
      "## Check output",
      "",
      "Some words.",
      "",
      "```text",
      "report.html",
      "",
      "  sources    1",
      "```",
      "",
      "```",
      "nor this one",
      "```",
    ].join("\n");
    assert.equal(
      fencedBlockUnder(markdown, "Check output"),
      "report.html\n\n  sources    1",
    );
    assert.equal(fencedBlockUnder("## Prompt\n\n```\nx\n```", "Missing"), null);
    assert.equal(
      fencedBlockUnder(
        "## Check output\n\nNo block.\n\n## Other\n\n```\nnot this\n```",
        "Check output",
      ),
      null,
    );
  });

  it("prints exactly the check output the README shows", async (t) => {
    const copy = tempDir(t);
    cpSync(EXAMPLE, copy, { recursive: true });
    const { code, out } = await runCli([
      "check",
      join(copy, "august-retention.html"),
    ]);
    assert.equal(code, 0);
    const readme = readFileSync(join(EXAMPLE, "README.md"), "utf8");
    assert.equal(out, fencedBlockUnder(readme, "Check output"));
  });

  it("lists every node once in the build order", () => {
    const readme = readFileSync(join(EXAMPLE, "README.md"), "utf8");
    const listed = orderedIdsUnder(readme, "Build order");
    const { nodes } = readGraph({ reportPath: EXAMPLE_REPORT }).graph;
    assert.deepEqual(listed.sort(), Object.keys(nodes).sort());
  });

  it("reads the ids that start the ordered list under a heading", () => {
    const markdown = [
      "## Other",
      "",
      "1. `zz` not this",
      "",
      "## Build order",
      "",
      "Words first.",
      "",
      "1. `q1` the source",
      "2. `v1`, then more",
      "3. no id here",
      "",
      "## After",
      "",
      "1. `yy` nor this",
    ].join("\n");
    assert.deepEqual(orderedIdsUnder(markdown, "Build order"), ["q1", "v1"]);
  });
});

describe("skill frontmatter", () => {
  it("reads the frontmatter fields", () => {
    const text =
      "---\nname: abc\ndescription: Does a thing: well.\n---\n\n# Abc\n\nname: not this\n";
    assert.deepEqual(frontmatter(text), {
      name: "abc",
      description: "Does a thing: well.",
    });
    assert.deepEqual(frontmatter("# No frontmatter\nname: x\n"), {});
  });

  it("meets the Agent Skills rules for name and description", () => {
    const { name, description } = frontmatter(
      readFileSync(new URL("SKILL.md", SKILL), "utf8"),
    );
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(name.length >= 1 && name.length <= 64);
    assert.equal(name, basename(fileURLToPath(SKILL)));
    assert.equal(typeof description, "string");
    assert.ok(description.length >= 1 && description.length <= 1024);
  });

  it("carries only the required fields", () => {
    const fields = frontmatter(
      readFileSync(new URL("SKILL.md", SKILL), "utf8"),
    );
    assert.deepEqual(Object.keys(fields).sort(), ["description", "name"]);
  });
});
