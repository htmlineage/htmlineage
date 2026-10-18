// The bridge runs inside the report frame. These tests run it as text in
// node:vm against a small stub of that frame: a report window over a document
// wider and taller than the pane, and elements with a fixed place on the page.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const BRIDGE = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "viewer",
    "client",
    "bridge.js",
  ),
  "utf8",
);

const DOC = { w: 1400, h: 5000 };
const PANE = { w: 830, h: 800 };

/**
 * Load the bridge into a stub frame.
 * @param {{ places?: {top: number, left?: number, width?: number, height?: number}[], scroll?: {x: number, y: number}, reduced?: boolean }} [opts]
 */
function frame({
  places = [{ top: 1500, left: 0, width: 760, height: 100 }],
  scroll = { x: 0, y: 0 },
  reduced = false,
} = {}) {
  const report = { ...scroll };
  const log = { viewerScrolled: false, behavior: null, posted: [] };
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  const set = (x, y, behavior = "instant") => {
    if (x !== undefined) report.x = clamp(x, DOC.w - PANE.w);
    if (y !== undefined) report.y = clamp(y, DOC.h - PANE.h);
    log.behavior = behavior;
  };
  const to = (a, b) =>
    typeof a === "object" && a !== null
      ? set(a.left, a.top, a.behavior ?? "auto")
      : set(a, b);
  const by = (a, b) =>
    typeof a === "object" && a !== null
      ? set(
          a.left === undefined ? undefined : report.x + a.left,
          a.top === undefined ? undefined : report.y + a.top,
          a.behavior ?? "auto",
        )
      : set(report.x + a, report.y + b);
  const scroller = {
    set scrollTop(v) {
      set(undefined, v);
    },
    get scrollTop() {
      return report.y;
    },
    set scrollLeft(v) {
      set(v, undefined);
    },
    get scrollLeft() {
      return report.x;
    },
  };

  const listeners = {};
  const target = () => ({
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
  });
  const element = (p) => {
    const classes = new Set();
    const attrs = { "data-lineage": "i_st_net" };
    return {
      classes,
      isConnected: true,
      offsetWidth: 0,
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
      },
      getAttribute: (n) => attrs[n] ?? null,
      hasAttribute: (n) => n in attrs,
      setAttribute: (n, v) => (attrs[n] = v),
      getBoundingClientRect: () => ({
        top: p.top - report.y,
        left: (p.left ?? 0) - report.x,
        width: p.width ?? 760,
        height: p.height ?? 100,
      }),
      scrollIntoView: () => (log.viewerScrolled = true),
    };
  };
  const els = places.map(element);

  const doc = {
    ...target(),
    readyState: "complete",
    head: { appendChild() {} },
    documentElement: scroller,
    scrollingElement: scroller,
    createElement: () => ({}),
    querySelectorAll: (sel) =>
      sel === "[data-lineage]"
        ? els
        : els.filter((el) => el.classes.has(sel.slice(1))),
  };
  const parent = { postMessage: (m) => log.posted.push(m) };
  const win = {
    ...target(),
    document: doc,
    parent,
    innerWidth: PANE.w,
    innerHeight: PANE.h,
    get scrollX() {
      return report.x;
    },
    get scrollY() {
      return report.y;
    },
    get pageXOffset() {
      return report.x;
    },
    get pageYOffset() {
      return report.y;
    },
    scrollTo: to,
    scroll: to,
    scrollBy: by,
    matchMedia: (q) => ({
      matches: reduced && q === "(prefers-reduced-motion: reduce)",
    }),
  };
  win.window = win;
  vm.runInNewContext(BRIDGE, win);

  return {
    els,
    report,
    log,
    send(data) {
      (listeners.message ?? []).forEach((fn) => fn({ source: parent, data }));
    },
  };
}

const SCROLL = { lineage: "scroll", id: "i_st_net", index: 0 };

describe("bridge", () => {
  describe("scroll", () => {
    it("never scrolls the viewer page", () => {
      const f = frame();
      f.send(SCROLL);
      assert.equal(f.log.viewerScrolled, false);
    });
    it("scrolls the report so the element sits in the middle", () => {
      const f = frame();
      f.send(SCROLL);
      assert.deepEqual(f.report, { x: 0, y: 1150 });
    });
    it("centres the element from wherever the report is scrolled", () => {
      const f = frame({ scroll: { x: 0, y: 600 } });
      f.send(SCROLL);
      assert.deepEqual(f.report, { x: 0, y: 1150 });
    });
    it("leaves the report's sideways scroll alone", () => {
      const f = frame({
        places: [{ top: 1500, left: 1000, width: 300, height: 100 }],
        scroll: { x: 300, y: 0 },
      });
      f.send(SCROLL);
      assert.deepEqual(f.report, { x: 300, y: 1150 });
    });
    it("scrolls smoothly", () => {
      const f = frame({ reduced: false });
      f.send(SCROLL);
      assert.equal(f.log.behavior, "smooth");
    });
    it("jumps when the reader asks for less motion", () => {
      const f = frame({ reduced: true });
      f.send(SCROLL);
      assert.notEqual(f.log.behavior, "smooth");
      assert.deepEqual(f.report, { x: 0, y: 1150 });
    });
    it("still outlines and flashes the place it scrolls to", () => {
      const f = frame({
        places: [
          { top: 1500, height: 100 },
          { top: 3000, height: 100 },
        ],
      });
      f.send({ lineage: "mark", id: "i_st_net" });
      f.send({ ...SCROLL, index: 1 });
      assert.ok(f.els[1].classes.has("tl-sel"));
      assert.ok(f.els[1].classes.has("tl-flash"));
      assert.equal(f.els[0].classes.has("tl-sel"), false);
      assert.equal(f.els[0].classes.has("tl-flash"), false);
      assert.deepEqual(f.report, { x: 0, y: 2650 });
    });
  });
});
