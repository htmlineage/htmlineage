import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { HtmlineageError } from "../src/errors.js";
import {
  findEmbeddedGraph,
  readGraph,
  serializeForEmbed,
  sidecarPath,
} from "../src/graph/parse.js";
import { FIXTURE_NAMES, loadFixture, tempDir } from "./helpers.js";

const page = (body) =>
  `<!doctype html>\n<html>\n<body>\n${body}\n</body>\n</html>\n`;
const block = (json, attrs = 'type="application/lineage+json"') =>
  `<script ${attrs} id="lineage-graph">${json}</script>`;

const failsWith = (pattern) => (error) =>
  error instanceof HtmlineageError && pattern.test(error.message);

describe("sidecarPath", () => {
  it("puts the graph in .lineage beside the report, named by its stem", () => {
    assert.equal(
      sidecarPath(join("reports", "august-retention.html")),
      join("reports", ".lineage", "august-retention.json"),
    );
  });

  it("gives two reports in one folder two graphs", () => {
    assert.notEqual(sidecarPath("a.html"), sidecarPath("b.html"));
  });
});

describe("findEmbeddedGraph", () => {
  it("returns null when there is no block", () => {
    assert.equal(
      findEmbeddedGraph(page("<p>hi</p><script>x()</script>")),
      null,
    );
  });

  it("returns the JSON and offsets that cover the whole element", () => {
    const html = page(block('{"a":1}'));
    const found = findEmbeddedGraph(html);
    assert.equal(found.content, '{"a":1}');
    assert.equal(html.slice(found.contentStart, found.contentEnd), '{"a":1}');
    assert.equal(html.slice(found.start, found.end), block('{"a":1}'));
  });

  for (const attrs of [
    "type='application/lineage+json'",
    "type=application/lineage+json",
    'TYPE="Application/Lineage+JSON"',
    'id="lineage-graph" type="application/lineage+json"',
  ]) {
    it(`finds the block with ${attrs}`, () => {
      assert.equal(findEmbeddedGraph(page(block("{}", attrs))).content, "{}");
    });
  }

  it("ignores lookalike attributes and ordinary scripts", () => {
    const html = page(
      '<script data-type="application/lineage+json">{}</script>' +
        '<script type="application/json">{}</script>',
    );
    assert.equal(findEmbeddedGraph(html), null);
  });

  it("refuses a page with two blocks", () => {
    assert.throws(
      () => findEmbeddedGraph(page(block("{}") + "\n" + block("{}"))),
      failsWith(/2 embedded lineage graphs \(at line 4, column 1, line 5/),
    );
  });

  it("does not end the block at a lookalike closing tag", () => {
    const json = '{"a":"</scripture>"}';
    assert.equal(findEmbeddedGraph(page(block(json))).content, json);
  });

  it("refuses an unclosed block", () => {
    assert.throws(
      () => findEmbeddedGraph('<script type="application/lineage+json">{}'),
      failsWith(/never closed/),
    );
  });
});

describe("serializeForEmbed", () => {
  const graph = {
    lineage: "1.0",
    nodes: { q1: { sql: "select '</script><!--' as trap where a < b" } },
  };

  it("never lets the graph close its own script element", () => {
    const text = serializeForEmbed(graph);
    assert.ok(!text.includes("<"));
    const found = findEmbeddedGraph(page(block(text)));
    assert.deepEqual(JSON.parse(found.content), graph);
  });
});

describe("readGraph", () => {
  for (const name of FIXTURE_NAMES) {
    it(`reads the ${name} fixture from its ${loadFixture(name).expected.origin}`, () => {
      const { reportPath, expected } = loadFixture(name);
      const { graph, origin } = readGraph({ reportPath });
      assert.equal(origin, expected.origin);
      assert.equal(graph.lineage, "1.0");
      assert.ok(Object.keys(graph.nodes).length > 0);
    });
  }

  it("prefers the sidecar over the embedded block", (t) => {
    const dir = tempDir(t);
    const report = join(dir, "august-retention.html");
    copyFileSync(loadFixture("clean").reportPath, report);
    mkdirSync(join(dir, ".lineage"));
    writeFileSync(sidecarPath(report), '{"lineage":"1.0","nodes":{}}');

    const { graph, origin, path } = readGraph({ reportPath: report });
    assert.equal(origin, "sidecar");
    assert.equal(path, sidecarPath(report));
    assert.deepEqual(graph.nodes, {});
  });

  it("reads the same object from the sidecar and the embedded block", (t) => {
    const dir = tempDir(t);
    const { reportPath } = loadFixture("clean");
    const embedded = readGraph({ reportPath }).graph;

    const report = join(dir, "august-retention.html");
    writeFileSync(report, page("<p>no block</p>"));
    mkdirSync(join(dir, ".lineage"));
    writeFileSync(sidecarPath(report), JSON.stringify(embedded, null, 2));
    assert.deepEqual(readGraph({ reportPath: report }).graph, embedded);
  });

  it("reads exactly the file named by graphPath", (t) => {
    const dir = tempDir(t);
    const graphPath = join(dir, "elsewhere.json");
    writeFileSync(graphPath, '{"lineage":"1.0","nodes":{}}');
    const { origin, path } = readGraph({
      reportPath: loadFixture("messy").reportPath,
      graphPath,
    });
    assert.equal(origin, "file");
    assert.equal(path, graphPath);
  });

  it("says where it looked when there is no graph", (t) => {
    const dir = tempDir(t);
    const report = join(dir, "plain.html");
    writeFileSync(report, page("<p>no lineage</p>"));
    assert.throws(
      () => readGraph({ reportPath: report }),
      failsWith(/no lineage graph found .*plain\.json/),
    );
  });

  it("names a missing report", (t) => {
    const dir = tempDir(t);
    assert.throws(
      () => readGraph({ reportPath: join(dir, "gone.html") }),
      failsWith(/report not found: .*gone\.html/),
    );
  });

  it("locates a JSON error in a sidecar by line and column", (t) => {
    const dir = tempDir(t);
    const report = join(dir, "r.html");
    mkdirSync(join(dir, ".lineage"));
    writeFileSync(
      sidecarPath(report),
      '{\n  "lineage": "1.0",\n  "nodes": {,}\n}',
    );
    assert.throws(
      () => readGraph({ reportPath: report }),
      failsWith(/r\.json is not valid JSON at line 3, column 13/),
    );
  });

  it("locates a JSON error in an embedded block by its line in the page", (t) => {
    const dir = tempDir(t);
    const report = join(dir, "r.html");
    writeFileSync(report, page(block('{\n  "nodes": {,}\n}')));
    assert.throws(
      () => readGraph({ reportPath: report }),
      failsWith(/embedded in .*r\.html is not valid JSON at line 5, column 13/),
    );
  });

  it("leaves the report bytes untouched", () => {
    const { reportPath } = loadFixture("clean");
    const before = readFileSync(reportPath);
    readGraph({ reportPath });
    assert.deepEqual(readFileSync(reportPath), before);
  });
});
