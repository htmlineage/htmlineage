import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "./helpers.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const BLOB = "https://github.com/htmlineage/htmlineage/blob/main/";
const TREE = "https://github.com/htmlineage/htmlineage/tree/main/";

/**
 * Read the shell commands out of markdown: lines starting with `npx` inside
 * ```bash or ```sh blocks, as word lists. A trailing `# comment` is dropped.
 */
function readCommands(markdown) {
  const commands = [];
  let inShell = false;
  let inOther = false;
  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      if (inShell || inOther) {
        inShell = false;
        inOther = false;
      } else if (fence[1] === "bash" || fence[1] === "sh") {
        inShell = true;
      } else {
        inOther = true;
      }
      continue;
    }
    if (!inShell || !line.startsWith("npx ")) continue;
    const words = line
      .replace(/\s+#.*$/, "")
      .trim()
      .split(/ +/);
    commands.push(words);
  }
  return commands;
}

/**
 * Read the inline link targets out of markdown, in order. Inline code is
 * blanked first, so a link-shaped string inside it is not a link; link text
 * in backticks still counts.
 */
function readLinks(markdown) {
  const links = [];
  const text = markdown.replace(/`[^`\n]*`(?!\])/g, (code) =>
    code.replace(/[[\]()]/g, " "),
  );
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    links.push(match[1]);
  }
  return links;
}

/** The README's htmlineage commands: the words after `htmlineage`, with the line. */
function htmlineageCommands(markdown) {
  return readCommands(markdown)
    .filter((words) => /^htmlineage(@|$)/.test(words[1]))
    .map((words) => words.slice(2));
}

/** The `src` and `srcset` paths of the README's opening `<picture>` block. */
function logoPaths(markdown) {
  const block = /^<picture>[\s\S]*?<\/picture>/m.exec(markdown)?.[0] ?? "";
  return [
    /<source\b[^>]*\bsrcset="([^"]*)"/.exec(block)?.[1],
    /<img\b[^>]*\bsrc="([^"]*)"/.exec(block)?.[1],
  ];
}

/** The README's second `<picture>` block: the viewer screenshot. */
function shotBlock(markdown) {
  const blocks = markdown.match(/<picture>[\s\S]*?<\/picture>/g) ?? [];
  return blocks[1] ?? "";
}

/** Replace the few HTML entities an `alt` value may carry. */
const decode = (text) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&");

const SHOTS = [
  ".github/assets/viewer-light.png",
  ".github/assets/viewer-dark.png",
];

const LOGOS = [".github/assets/logo-light.svg", ".github/assets/logo-dark.svg"];

// npm shows the README of the published version and does not resolve
// relative paths inside HTML tags, so images point at the repo's raw files.
const RAW = "https://raw.githubusercontent.com/htmlineage/htmlineage/main/";

/** The repo path an image URL points at, or null if it is not under RAW. */
const repoPath = (url) =>
  url && url.startsWith(RAW) ? url.slice(RAW.length) : null;

describe("readme", () => {
  it("points every image at the repo's raw files, so npm shows them", () => {
    const markdown = read("README.md");
    const urls = [
      ...markdown.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)="([^"]*)"/g),
    ].map((m) => m[1]);
    assert.equal(urls.length, 4);
    assert.deepEqual(
      urls.filter((url) => repoPath(url) === null),
      [],
    );
  });

  it("opens with the logo, light and dark", () => {
    const markdown = read("README.md");
    assert.equal(
      markdown.split(/\r?\n/).find((l) => l.trim() !== ""),
      "<picture>",
    );
    const block = /<picture>[\s\S]*?<\/picture>/.exec(markdown)[0];
    assert.ok(
      block.includes(
        `<source media="(prefers-color-scheme: dark)" srcset="${RAW}.github/assets/logo-dark.svg">`,
      ),
    );
    assert.ok(
      block.includes(
        `<img src="${RAW}.github/assets/logo-light.svg" alt="htmlineage"`,
      ),
    );
    assert.ok(!markdown.split(/\r?\n/).includes("# htmlineage"));
  });

  it("points the logo at files in the repo", () => {
    const paths = logoPaths(read("README.md"));
    assert.equal(paths.length, 2);
    const missing = paths.filter(
      (url) => !repoPath(url) || !existsSync(ROOT + repoPath(url)),
    );
    assert.deepEqual(missing, []);
  });

  it("draws the logo without needing the font", () => {
    for (const name of LOGOS) {
      const svg = read(name);
      assert.match(svg, /^(<\?xml[^>]*\?>\s*)?<svg\b/, name);
      assert.match(svg, /\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, name);
      assert.match(svg, /\bviewBox="/, name);
      assert.doesNotMatch(svg, /<text\b|@font-face|href=|url\(/, name);
    }
  });

  it("colours the logo for each mode", () => {
    const colours = (name) => [
      ...new Set(
        (read(name).match(/#[0-9a-f]{6}\b/gi) ?? []).map((c) =>
          c.toLowerCase(),
        ),
      ),
    ];
    assert.deepEqual(colours(LOGOS[0]).sort(), ["#1f2328", "#2557d6"]);
    assert.deepEqual(colours(LOGOS[1]).sort(), ["#8fb0ff", "#dfe2e8"]);
  });

  it("shows the viewer under the opening lines, light and dark", () => {
    const block = shotBlock(read("README.md"));
    assert.ok(
      block.includes(
        `<source media="(prefers-color-scheme: dark)" srcset="${RAW}.github/assets/viewer-dark.png">`,
      ),
    );
    assert.ok(
      block.includes(`<img src="${RAW}.github/assets/viewer-light.png"`),
    );
    const alt =
      /\balt="([^"]*)"/.exec(block)?.[1] ?? /\balt='([^']*)'/.exec(block)?.[1];
    assert.equal(
      decode(alt ?? ""),
      'The htmlineage viewer: a quarterly business review on the left, and on the right how its "Gap to year-end target" figure was computed',
    );
  });

  it("puts the screenshot right after the tagline", () => {
    const lines = read("README.md").split(/\r?\n/);
    const logoEnd = lines.indexOf("</picture>");
    const shotStart = lines.indexOf("<picture>", logoEnd);
    const between = lines.slice(logoEnd + 1, shotStart).filter((l) => l.trim());
    assert.equal(between.length, 1);
    assert.ok(
      between[0].startsWith("**A provenance layer for AI-generated reports.**"),
    );
    const shotEnd = lines.indexOf("</picture>", shotStart);
    const after = lines.slice(shotEnd + 1).filter((l) => l.trim());
    assert.ok(after[1].startsWith("AI writes analytics reports"));
  });

  it("captions the screenshot as sample data", () => {
    const lines = read("README.md").split(/\r?\n/);
    const shotEnd = lines.indexOf(
      "</picture>",
      lines.indexOf("</picture>") + 1,
    );
    const caption = lines.slice(shotEnd + 1).find((l) => l.trim());
    assert.equal(
      caption,
      "<sub>The viewer on a sample report. Halden is a fictional company and its data is made up.</sub>",
    );
  });

  it("points the screenshot at files in the repo", () => {
    const block = shotBlock(read("README.md"));
    const paths = [
      /<source\b[^>]*\bsrcset="([^"]*)"/.exec(block)?.[1],
      /<img\b[^>]*\bsrc="([^"]*)"/.exec(block)?.[1],
    ];
    assert.equal(paths.length, 2);
    const missing = paths.filter(
      (url) => !repoPath(url) || !existsSync(ROOT + repoPath(url)),
    );
    assert.deepEqual(missing, []);
  });

  it("ships the screenshot at twice a 1440 by 900 window", () => {
    for (const name of SHOTS) {
      const head = readFileSync(ROOT + name).subarray(0, 24);
      assert.equal(
        head.subarray(0, 8).toString("hex"),
        "89504e470d0a1a0a",
        name,
      );
      assert.deepEqual(
        [head.readUInt32BE(16), head.readUInt32BE(20)],
        [2880, 1800],
        name,
      );
    }
  });

  it("reads the shell commands out of fenced blocks", () => {
    const markdown = [
      "Run `npx htmlineage view x.html` in prose.",
      "",
      "```bash",
      "npx skills add htmlineage/htmlineage -s htmlineage",
      "npx htmlineage check report.html       # validate and embed",
      "npx htmlineage@next sql report.html --id f3",
      "",
      "ls -la",
      "```",
      "",
      "```text",
      "npx htmlineage view not-a-command.html",
      "```",
    ].join("\n");
    assert.deepEqual(readCommands(markdown), [
      ["npx", "skills", "add", "htmlineage/htmlineage", "-s", "htmlineage"],
      ["npx", "htmlineage", "check", "report.html"],
      ["npx", "htmlineage@next", "sql", "report.html", "--id", "f3"],
    ]);
  });

  it("reads the link targets", () => {
    const markdown = [
      "See [the format](skills/htmlineage/references/format.md) and",
      `[rules](${BLOB}CHECKS.md).`,
      "Copy [`skills/htmlineage/`](skills/htmlineage/). Skills: [skills.sh](https://skills.sh).",
      "Jump [up](#install). Not a link: `[x](y)` in code.",
    ].join("\n");
    assert.deepEqual(readLinks(markdown), [
      "skills/htmlineage/references/format.md",
      `${BLOB}CHECKS.md`,
      "skills/htmlineage/",
      "https://skills.sh",
      "#install",
    ]);
  });

  it("shows only htmlineage commands the CLI accepts", async () => {
    for (const args of htmlineageCommands(read("README.md"))) {
      const { code, err } = await runCli([...args, "--help"]);
      assert.deepEqual(
        { line: args.join(" "), code, err },
        { line: args.join(" "), code: 0, err: "" },
      );
    }
  });

  it("shows each command", () => {
    const commands = htmlineageCommands(read("README.md"));
    const has = (name, flag) =>
      commands.some((a) => a[0] === name && (!flag || a.includes(flag)));
    assert.deepEqual(
      {
        check: has("check"),
        view: has("view"),
        sql: has("sql"),
        id: has("sql", "--id"),
      },
      { check: true, view: true, sql: true, id: true },
    );
  });

  it("runs htmlineage with no version tag", () => {
    const line = read("README.md")
      .split(/\r?\n/)
      .find((l) => /htmlineage@/.test(l));
    assert.equal(line, undefined);
  });

  it("installs the skill with skills.sh", () => {
    assert.ok(
      readCommands(read("README.md")).some(
        (w) =>
          w.join(" ") === "npx skills add htmlineage/htmlineage -s htmlineage",
      ),
    );
  });

  it("links only to files in the repo", () => {
    const missing = readLinks(read("README.md"))
      .map((link) => {
        for (const prefix of [BLOB, TREE]) {
          if (link.startsWith(prefix)) return link.slice(prefix.length);
        }
        return /^[a-z][a-z0-9+.-]*:|^#/i.test(link) ? null : link;
      })
      .filter((path) => path !== null && !existsSync(ROOT + path));
    assert.deepEqual(missing, []);
  });

  it("links the references a reader needs", async () => {
    const { out } = await runCli(["check", "--help"]);
    const helpUrl = out.trim().split(/\r?\n/).at(-1).trim();
    const wanted = [
      "skills/htmlineage/references/format.md",
      "skills/htmlineage/references/example/",
      "skills/htmlineage/references/review.md",
      "SECURITY.md",
      helpUrl,
    ];
    const links = readLinks(read("README.md"));
    assert.deepEqual(
      wanted.filter((w) => !links.includes(w)),
      [],
    );
    assert.equal(helpUrl, `${BLOB}CHECKS.md`);
  });
});

describe("contributing", () => {
  it("names every source folder in the repo layout", () => {
    const text = read("CONTRIBUTING.md");
    const folders = readdirSync(new URL("../src/", import.meta.url), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => `src/${e.name}/`);
    assert.deepEqual(
      [...folders, "skills/"].filter((f) => !text.includes(f)),
      [],
    );
  });
});
