import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "../src/viewer/server.js";
import { loadFixture } from "./helpers.js";

const CLIENT = fileURLToPath(new URL("../src/viewer/client/", import.meta.url));

// Start on a free port; closed when the test ends.
const serve = async (t, options) => {
  const s = await startServer({ port: 0, exact: true, ...options });
  t.after(() => s.close());
  return s;
};

// GET `path` exactly as written.
const get = (server, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: server.port, path }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      })
      .on("error", reject);
  });

const read = (name) => readFileSync(join(CLIENT, name), "utf8");
const reportPath = loadFixture("clean").reportPath;
const brand = () =>
  /<a\b[^>]*\bclass="brand"[\s\S]*?<\/a>/.exec(read("index.html"))[0];

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

describe("panel files", () => {
  it("serves the panel's scripts and styles", async (t) => {
    const s = await serve(t, { reportPath });
    const types = {
      "viewer.js": "text/javascript; charset=utf-8",
      "lineage.js": "text/javascript; charset=utf-8",
      "viewer.css": "text/css; charset=utf-8",
      "themes.css": "text/css; charset=utf-8",
    };
    for (const [name, type] of Object.entries(types)) {
      const res = await get(s, `/assets/${name}`);
      assert.equal(res.status, 200, name);
      assert.equal(res.headers["content-type"], type, name);
    }
  });
  it("serves everything the page and its styles point to", async (t) => {
    const s = await serve(t, { reportPath });
    const css = ["viewer.css", "themes.css"].map(read).join("\n");
    const html = read("index.html");
    const found = [
      ...[...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]),
      ...[...css.matchAll(/url\(\s*["']?([^"')]*)/g)].map((m) => m[1]),
    ].filter((ref) => ref !== "#");
    assert.ok(found.length > 0);
    for (const ref of found) {
      assert.equal((await get(s, ref)).status, 200, ref);
    }
  });
  it("loads the mono and serif weights from the package", () => {
    const css = ["viewer.css", "themes.css"].map(read).join("\n");
    const fonts = [...css.matchAll(/url\(\s*["']?([^"')]*\.woff2)/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(fonts.sort(), [
      "/assets/fonts/JetBrainsMono-Bold.woff2",
      "/assets/fonts/JetBrainsMono-Medium.woff2",
      "/assets/fonts/JetBrainsMono-Regular.woff2",
      "/assets/fonts/JetBrainsMono-SemiBold.woff2",
      "/assets/fonts/SourceSerif4-Medium.woff2",
      "/assets/fonts/SourceSerif4-Regular.woff2",
      "/assets/fonts/SourceSerif4-SemiBold.woff2",
    ]);
  });
  it("sandboxes the report frame", () => {
    const frame = /<iframe\b[^>]*\bid="report"[^>]*>/.exec(read("index.html"));
    assert.ok(frame);
    const sandbox = /\bsandbox="([^"]*)"/.exec(frame[0]);
    assert.ok(sandbox);
    assert.equal(sandbox[1], "allow-scripts allow-popups");
  });
  it("does not reach into the report frame", () => {
    assert.doesNotMatch(
      read("viewer.js"),
      /contentDocument|contentWindow\.document/,
    );
  });
  it("keeps the bridge a plain script that can sit inline", () => {
    const bridge = read("bridge.js");
    assert.ok(bridge.trim().length > 0);
    assert.doesNotMatch(bridge, /^\s*(import|export)\b/m);
    assert.doesNotMatch(bridge, /<\/script/i);
  });
  it("serves the bridge with the other assets", async (t) => {
    const s = await serve(t, { reportPath });
    const res = await get(s, "/assets/bridge.js");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
  });
  it("points nowhere off the machine", () => {
    const files = readdirSync(CLIENT).filter((name) =>
      /\.(html|js|css)$/.test(name),
    );
    assert.ok(files.length >= 5);
    for (const name of files) {
      assert.doesNotMatch(read(name), /https?:\/\//, name);
    }
  });
  it("links an SVG favicon", async (t) => {
    const links = [...read("index.html").matchAll(/<link\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /\brel="icon"/.test(tag));
    assert.equal(links.length, 1);
    assert.match(links[0], /\btype="image\/svg\+xml"/);
    assert.match(links[0], /\bhref="\/assets\/favicon\.svg"/);
    const s = await serve(t, { reportPath });
    const res = await get(s, "/assets/favicon.svg");
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/svg+xml");
  });
  it("makes the favicon a standalone SVG", () => {
    const svg = read("favicon.svg");
    assert.match(svg, /^(<\?xml[^>]*\?>\s*)?<svg\b/);
    assert.match(svg, /\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /\bviewBox="/);
    assert.doesNotMatch(svg, /href=|url\(|@import/);
  });
  it("draws the favicon as the traced l alone", () => {
    const svg = read("favicon.svg");
    assert.equal(svg.match(/<path\b/g).length, 1);
    assert.equal(svg.match(/<circle\b/g).length, 2);
    assert.doesNotMatch(svg, /<text\b|<rect\b/);
  });
  it("colours the favicon for light and dark browsers", () => {
    const svg = read("favicon.svg");
    const colours = new Set(
      (svg.match(/#[0-9a-f]{6}\b/gi) ?? []).map((c) => c.toLowerCase()),
    );
    assert.deepEqual([...colours].sort(), ["#2557d6", "#8fb0ff"]);
    assert.ok(svg.includes("@media (prefers-color-scheme: dark)"));
  });
  it("spells the wordmark with a drawn l and no gaps", () => {
    assert.match(brand(), /htm<svg\b[\s\S]*?<\/svg\s*>ineage/);
  });
  it("drops the two-bar mark", () => {
    assert.equal(brand().match(/<svg\b/g).length, 1);
    assert.doesNotMatch(brand(), /<rect\b/);
  });
  it("keeps the drawn l out of the accessible name", () => {
    assert.match(/<svg\b[^>]*>/.exec(brand())[0], /\baria-hidden="true"/);
    assert.match(
      /<a\b[^>]*>/.exec(brand())[0],
      /\baria-label="htmlineage, report summary"/,
    );
  });
  const brandRules = () =>
    [
      ...read("viewer.css")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{([^}]*)\}/g),
    ]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }))
      .filter(({ selector }) => selector.startsWith(".brand"));

  it("draws the l in the accent colour of either mode", () => {
    assert.doesNotMatch(brand(), COLOUR_LITERAL);
    assert.ok(
      brand().includes("var(--act)") ||
        brandRules().some(({ body }) => body.includes("var(--act)")),
    );
  });

  it("pins no colour literal in a brand rule", () => {
    const pinned = brandRules().filter(({ body }) => COLOUR_LITERAL.test(body));
    assert.deepEqual(pinned, []);
  });
});
