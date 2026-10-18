import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFileSync } from "node:fs";

import { RULES as CROSS_RULES } from "../src/check/rules.js";
import { RULES as SCHEMA_RULES } from "../src/graph/schema.js";

/**
 * Read the rule sections out of markdown: one entry per `###` heading, with
 * its code, title, and the severity from the section's own `**Severity:**`
 * line (null when the section has none).
 */
function readSections(markdown) {
  const sections = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^### ([^:]+?)(?:: (.*))?$/.exec(line);
    if (heading) {
      sections.push({
        code: heading[1],
        title: heading[2] ?? "",
        severity: null,
      });
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      sections.push(null);
      continue;
    }
    const current = sections.at(-1);
    const severity = /^\*\*Severity:\*\* (error|warning)$/.exec(line);
    if (current && severity && current.severity === null) {
      current.severity = severity[1];
    }
  }
  return sections.filter(Boolean);
}

describe("rule reference", () => {
  it("reads each rule section's code, title and severity", () => {
    const markdown = `# Rules

## Shape rules

### S1: graph header is malformed

**Severity:** error

Prose that mentions **Severity:** warning mid-line.

### Exit codes

## Consistency rules

### C2: number in prose is outside a figure's span

Some text first.

**Severity:** warning
`;
    assert.deepEqual(readSections(markdown), [
      { code: "S1", title: "graph header is malformed", severity: "error" },
      { code: "Exit codes", title: "", severity: null },
      {
        code: "C2",
        title: "number in prose is outside a figure's span",
        severity: "warning",
      },
    ]);
  });

  const tricky = `## Group

### Exit codes

Mentions **Severity:** error

## Next group

**Severity:** error

### S1: first line wins

**Severity:** error trailing words

**Severity:** warning

**Severity:** error
`;
  const trickyWant = [
    { code: "Exit codes", title: "", severity: null },
    { code: "S1", title: "first line wins", severity: "warning" },
  ];

  it("ignores severity text that is mid-line, trails, or sits past a group heading", () => {
    assert.deepEqual(readSections(tricky), trickyWant);
  });

  it("reads a file with CRLF line endings", () => {
    assert.deepEqual(readSections(tricky.replaceAll("\n", "\r\n")), trickyWant);
  });

  const readDoc = () =>
    readSections(
      readFileSync(new URL("../CHECKS.md", import.meta.url), "utf8"),
    );

  /** Rules in `rules` that CHECKS.md lacks or lists with another severity. */
  function problems(rules) {
    const sections = readDoc();
    const missing = [];
    const wrong = [];
    for (const [code, { severity }] of Object.entries(rules)) {
      const section = sections.find((s) => s.code === code);
      if (!section) missing.push(code);
      else if (section.severity !== severity) {
        wrong.push(`${code}: want ${severity}, got ${section.severity}`);
      }
    }
    return { missing, wrong };
  }

  it("explains every rule the schema raises, with its severity", () => {
    assert.deepEqual(problems(SCHEMA_RULES), { missing: [], wrong: [] });
  });

  it("explains every rule the cross-node checks raise, with its severity", () => {
    assert.deepEqual(problems(CROSS_RULES), { missing: [], wrong: [] });
  });

  it("lists the rules in code order", () => {
    const order = (prefix) =>
      Array.from({ length: 9 }, (_, i) => `${prefix}${i + 1}`);
    assert.deepEqual(
      readDoc().map((s) => s.code),
      [...order("S"), ...order("C")],
    );
  });

  const RULES = { ...SCHEMA_RULES, ...CROSS_RULES };

  it("titles each rule as the code does", () => {
    const titles = Object.fromEntries(readDoc().map((s) => [s.code, s.title]));
    const want = Object.fromEntries(
      Object.entries(RULES).map(([code, { title }]) => [code, title]),
    );
    assert.deepEqual(titles, want);
  });

  it("names a real rule in every section", () => {
    const codes = readDoc().map((s) => s.code);
    assert.deepEqual(
      codes.filter((code) => !(code in RULES)),
      [],
      "headings that are not rules",
    );
    assert.deepEqual(
      codes.filter((code, i) => codes.indexOf(code) !== i),
      [],
      "rules listed twice",
    );
  });
});
