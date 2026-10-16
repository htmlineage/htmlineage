// The viewer page: click a number, see how it was computed, read from the
// number down to its sources as an outline of rows that open in place. All
// the logic with no page in it is in lineage.js; this file is the DOM, the
// events, the report frame and the clipboard.
import {
  exprParts,
  isArithmetic,
  builtFrom,
  builtOn,
  chainSql,
  checkStatus,
  copyText,
  fromReport,
  groundOf,
  grounding,
  headline,
  highlightSql,
  inputRow,
  mismatches,
  nodesOf,
  outline,
  outlineKeys,
  ownCard,
  reportCounts,
  reportSql,
  selection,
  stepFacts,
  stepHead,
  stepSql,
  stepText,
  title,
  untraced,
} from "./lineage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const ICON = {
  back: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/></svg>',
  chev: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5"/></svg>',
  caret:
    '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5 6 4l3.5 3.5"/></svg>',
  page: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/></svg>',
  point:
    '<svg viewBox="0 0 26 26" aria-hidden="true"><path d="M4 13h13M12 8l5 5-5 5"/><path d="M21 4v18M24 4v18"/></svg>',
};

// ---------- state ----------
const S = {
  fx: null,
  nodes: {},
  sel: null,
  history: [],
  sqlOpen: new Map(),
  // the outline rows the reviewer has opened, as keys from `outline`: going
  // down, and under "what uses this"
  openDown: new Set(),
  openUp: new Set(),
  showUses: false,
  counts: {},
  cycle: {},
  drawer: false,
  flash: null,
};

// A new selection starts with every row closed.
function startOver() {
  S.openDown = new Set();
  S.openUp = new Set();
  S.showUses = false;
}

function load(fx) {
  S.fx = fx;
  S.nodes = nodesOf(fx.graph);
  S.sel = null;
  S.history = [];
  S.sqlOpen = new Map();
  startOver();
  S.cycle = {};
  S.drawer = false;
}

// ---------- reading the graph ----------
const stepWord = (id) => stepHead(S.fx.graph, id).kind;
// The swatch class for what a node rests on.
const SWATCH = { sql: "full", file: "partial", none: "ungrounded" };
const state = (id) => SWATCH[groundOf(S.fx, id)];
const val = (id) => {
  const n = S.nodes[id];
  return n ? String(n.display ?? n.value ?? "") : "";
};
const nameOf = (id) => title(S.fx.graph, id);
const visual = (id) => {
  const v = S.nodes[id]?.encoding?.visual;
  return v ? (v === "table" ? "table" : `${v} chart`) : "view";
};

const fmtDate = (d) => {
  const [y, m, day] = String(d).split("-").map(Number);
  if (!y || !m || !day) return esc(d);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};
// let long identifiers break after dots and underscores
const wb = (s) => esc(s).replace(/([._])/g, "$1<wbr>");
const period = (p) => (p ? `${fmtDate(p.from)} – ${fmtDate(p.to)}` : "");

const codeify = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

// ---------- small renderers ----------
const idBtn = (id) =>
  S.nodes[id]
    ? `<button class="id" type="button" data-go="${esc(id)}" title="${esc(stepWord(id))}: ${esc(nameOf(id))}">${esc(id)}</button>`
    : `<span class="id missing" title="Not in the graph">${esc(id)}</span>`;
const sw = (st) => `<span class="sw ${st}" aria-hidden="true"></span>`;
// A copy button. When there is nothing to copy it is disabled and says why.
const copyBtn = (attr, id, { sql, reason }, label, tip) =>
  `<button class="btn" type="button" ${attr}="${esc(id)}" ${sql === null ? "disabled" : ""} title="${esc(reason ?? tip)}">${ICON.copy}${label}</button>`;
const STATE_WORD = {
  sql: "Traced to the warehouse",
  file: "Rests on a file",
  none: "Nothing behind it",
};

// A source's name and what the reviewer should know about its period.
const sourceRow = (row, { count }) => {
  const mart = row.kind === "sql";
  const numbers = count
    ? ` · ${row.numbers}&nbsp;number${row.numbers === 1 ? "" : "s"}`
    : "";
  const when = mart
    ? `${row.period ? esc(period(row.period)) : "No period"}${row.pinned ? "" : " · not pinned"}${numbers}`
    : `external file${numbers}`;
  return `<li>${sw(mart ? "full" : "partial")}<span class="what"><code>${wb(row.name ?? "(no name)")}</code></span><span class="when${mart && !row.pinned ? " warn" : ""}">${when}</span></li>`;
};

const C3_WORDS =
  "Recalculate this number: the figure in the graph does not match the one on the screen";
const c3Values = (m) =>
  [
    m.page.length ? `page ${m.page.join(", ")}` : "",
    m.graph !== null ? `graph ${m.graph}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const colsLine = (cols) =>
  Array.isArray(cols) && cols.length
    ? `<p class="reads cols">Columns: ${cols.map((c) => `<code>${esc(c)}</code>`).join(", ")}</p>`
    : "";

// A step's SQL, highlighted, with Copy. A source's or view's columns come
// first, and an expression figure shows its expression as written.
function sqlBlock(id) {
  const n = S.nodes[id];
  const sql = typeof n.sql === "string" && n.sql.trim() ? n.sql : "";
  const shown = (sql || String(n.expr ?? "")).replace(/\s+$/, "");
  const lines = shown.split("\n").length;
  const cols = n.step === "figure" ? "" : colsLine(n.columns);
  return `${cols}<div class="snip"><pre>${highlightSql(shown)}</pre><div class="snip-bar"><span class="muted" style="font-size:12.5px">${lines} line${lines > 1 ? "s" : ""}</span><span class="gap"></span>${sql ? copyBtn("data-copy-sql", id, stepSql(S.fx, id), "Copy SQL", "") : ""}</div></div>`;
}

// How many places a node has on the page, as the report said when it loaded.
const pageCount = (id) => S.counts[id] || 0;

// The formula of an expression figure: with ids, then values, then the result.
function formula(f) {
  const tokens = (fn) =>
    exprParts(f.expr, (t) => Boolean(S.nodes[t]))
      .map((p) => (p.id ? fn(p.id) : esc(p.text)))
      .join("");
  return `<div class="formula" title="${isArithmetic(f.expr) ? "Arithmetic" : "A SQL expression"} over other numbers"><span class="eq"></span><span>${tokens((t) => idBtn(t))}</span><span class="eq">=</span><span>${tokens((t) => esc(val(t)))}</span><span class="eq">=</span><span class="res res-line">${esc(f.value ?? "")}</span></div>`;
}

// "N columns", with the names on hover.
const colsMeta = (cols) =>
  `<span title="${esc(cols.join(", "))}">${cols.length} column${cols.length === 1 ? "" : "s"}</span>`;

// One step's card, in three parts:
//   line  its title from stepHead: the desc, or what the step is called;
//         a source leads with its mart and puts its desc under it
//   meta  kind, then the facts from its fields, then the SQL toggle
//   more  a note, the formula, the SQL when open
// The clicked step drops what the head already shows: stepHead gives it no
// kind or value. A `bare` card, inside an open row, drops its title line and
// kind too, which the row above it shows; a source keeps its desc.
function stepCard(id, { isTop = false, bare = false } = {}) {
  const n = S.nodes[id];
  const head = stepHead(S.fx.graph, id, { top: isTop });
  const { note, show } = stepText(S.fx.graph, id);
  const f = n && !n.ungrounded ? stepFacts(S.fx, id) : null;
  const from = (ids) => (ids || []).map(idBtn).join(" ");

  let line = "";
  let sub = "";
  let right = "";
  let clamped = false;
  const meta = [];
  if (head.kind !== null && !bare)
    meta.push(`<span class="kind">${esc(head.kind)}</span>`);

  if (!n) {
    line = `<code>${esc(id)}</code>`;
    meta.push(`<span class="stop">not in the graph</span>`);
  } else if (n.ungrounded) {
    line = esc(head.title ?? "");
    meta.push(
      `<span class="stop">nothing behind it · ask the builder where it comes from</span>`,
    );
  } else {
    // a source's title is its mart, a name rather than words to clamp
    clamped = (isTop || n.step !== "source") && Boolean(head.title);
    line =
      n.step === "source" && !isTop
        ? `<code>${wb(head.title ?? "(no name)")}</code>`
        : esc(head.title ?? "");
    if (head.sub)
      sub = `<p class="sub" title="${esc(head.sub)}">${esc(head.sub)}</p>`;
    if (head.value !== null)
      right = `<span class="fig">${esc(head.value)}</span>`;
    if (f.kind === "sql") {
      meta.push(
        `<span${f.pinned ? "" : ` class="warn"`}>${esc(f.period ? period(f.period) : "no period")}${f.pinned ? "" : " · not pinned"}</span>`,
      );
      if (f.how) meta.push(esc(f.how));
    } else if (f.kind === "external") {
      meta.push(
        `<span class="warn">external ${esc(n.type || "file")} · Trailline can't see inside it</span>`,
      );
      if (f.columns.length) meta.push(colsMeta(f.columns));
    } else if (f.kind === "view") {
      if (head.kind !== null)
        right = pageCount(id)
          ? `<button class="link fig-link" type="button" data-scroll="${esc(id)}" title="Show it on the page">${esc(visual(id))}</button>`
          : `<span class="fig small">${esc(visual(id))}</span>`;
      if (f.from.length) meta.push(`from ${from(f.from)}`);
      if (f.columns.length) meta.push(colsMeta(f.columns));
    } else if (f.kind === "pick") {
      if (f.from.length) meta.push(`picks from ${from(f.from)}`);
    } else if (f.kind === "claim") {
      const parts = f.from.map(
        (p) =>
          `${idBtn(p)}${S.nodes[p]?.step === "figure" ? ` <b>${esc(val(p))}</b>` : ""}`,
      );
      meta.push(
        parts.length
          ? `rests on ${parts.join(", ")}`
          : `<span class="stop">rests on nothing · ask the builder where it comes from</span>`,
      );
    }
  }

  const open = show !== null && (S.sqlOpen.get(id) ?? show.open);
  if (show)
    meta.push(
      `<button class="tog" type="button" data-sql="${esc(id)}" aria-expanded="${open}">${ICON.chev}${esc(show.label)}</button>`,
    );

  // the clicked step has no kind word, so its facts start the sentence
  if (isTop && meta.length)
    meta[0] = meta[0].replace(
      /^(<span[^>]*>)?([a-z])/,
      (_, tag = "", c) => tag + c.toUpperCase(),
    );

  let more = "";
  if (note) more += `<p class="reads"><b>Note</b> ${esc(note)}</p>`;
  if (f?.kind === "formula") more += formula(f);
  if (open) more += sqlBlock(id);

  // a long desc is cut to two lines until its SQL is open; hover shows it whole
  const clamp = clamped && !open ? " clamp" : "";
  const tip = clamp ? ` title="${esc(head.title)}"` : "";
  const titleRow =
    !bare && (line || right)
      ? `<div class="step-h">${isTop ? "" : idBtn(id)}<span class="ttl${clamp}"${tip}>${line}</span>${right}</div>`
      : "";
  return `<div class="card${bare ? " bare" : ""}">
          ${titleRow}${sub}
          ${meta.length ? `<p class="meta">${meta.join(`<span class="sep" aria-hidden="true">·</span>`)}</p>` : ""}
          ${more}
        </div>`;
}

// ---------- the outline ----------
// A step's rows, closed until the reviewer opens them. `branch` is the
// clicked step, then each row opened on the way down to this one; which rows
// there are, their keys and the caption come from `outline`.
function rowsHtml(branch, up) {
  const { label, rows } = outline(S.fx.graph, branch, { up });
  if (!rows.length) return "";
  const opened = up ? S.openUp : S.openDown;
  const onPage = Object.keys(S.counts);
  const items = rows
    .map((r) => {
      const info = inputRow(S.fx, r.id, { onPage });
      const open = !r.loop && opened.has(r.key);
      const source = info.kind === "Source";
      const ttl = source
        ? `<code>${wb(info.title ?? r.id)}</code>`
        : esc(info.title ?? "");
      const meta = [`<span class="kind">${esc(info.kind)}</span>`];
      if (r.loop)
        meta.push(`<span class="stop">loops back to ${esc(r.id)}</span>`);
      else if (info.note)
        meta.push(`<span class="stop">${esc(info.note)}</span>`);
      if (info.onPage) meta.push(`<span class="onpage">on the page</span>`);
      if (!up && !source && !r.loop && info.ends.length)
        meta.push(
          `<span class="ends">from ${info.ends.map((e) => `<code>${wb(e)}</code>`).join(", ")}</span>`,
        );
      const known = Boolean(S.nodes[r.id]);
      const body = open
        ? `<div class="ol-body">
        ${known ? stepCard(r.id, { bare: true }) : ""}
        <div class="ol-acts">${known ? `<button class="link" type="button" data-go="${esc(r.id)}">Select ${esc(r.id)}</button>` : ""}${info.onPage ? `<button class="link" type="button" data-scroll="${esc(r.id)}">↗ On the page</button>` : ""}</div>
        ${rowsHtml([...branch, r.id], up)}
      </div>`
        : "";
      return `<li class="ol-item${open ? " is-open" : ""}" data-row="${esc(r.id)}">
      <button class="ol-row" type="button" ${r.loop ? "disabled" : `data-tog="${esc(r.key)}"${up ? " data-up" : ""} aria-expanded="${open}"`}>
        <span class="ol-chev" aria-hidden="true">${r.loop ? "" : ICON.chev}</span>
        ${sw(state(r.id))}
        <span class="ol-main"><span class="ol-t"><span class="id">${esc(r.id)}</span> ${ttl}</span><span class="ol-meta">${meta.join(`<span class="sep" aria-hidden="true">·</span>`)}</span></span>
        ${info.value !== null ? `<span class="fig">${esc(info.value)}</span>` : ""}
      </button>
      ${body}
    </li>`;
    })
    .join("");
  return `<p class="ol-cap">${esc(label)}</p><ul class="ol">${items}</ul>`;
}

// ---------- default state: the summary ----------
// A row that opens a node, or plain text when it has none.
const goRow = (node, swatch, html) =>
  node === null
    ? `<li><div class="plain">${sw(swatch)}<span class="what">${html}</span></div></li>`
    : `<li><button type="button" data-go="${esc(node)}" data-from-summary>${sw(swatch)}<span class="id">${esc(node)}</span><span class="what">${html}</span></button></li>`;

const NOT_TRACED = {
  figure: "Number",
  bare: "Number in the text",
  claim: "Claim",
};

function renderSummary() {
  const lines = headline(grounding(S.fx));
  const built = builtOn(S.fx);
  const checks = mismatches(S.fx);
  const open = untraced(S.fx);
  const lede = [lines.numbers, lines.claims]
    .filter(Boolean)
    .map((l) => {
      // the first sentence leads; the counts that follow sit quieter under it
      const [lead, ...more] = l.split(/(?<=\.)\s+/);
      return `<p class="lede-sub">${esc(lead)}${more.length ? `<span class="lede-more">${esc(more.join(" "))}</span>` : ""}</p>`;
    })
    .join("");
  return `<div class="sec">${lede}</div>
      ${built.length ? `<div class="sec"><h2 class="h">Built on</h2><ul class="built">${built.map((r) => sourceRow(r, { count: true })).join("")}</ul></div>` : ""}
      ${checks.length ? `<div class="sec"><h2 class="h">Check these numbers <small>${checks.length}</small></h2><ul class="attn">${checks.map((m) => goRow(m.node, "stopw", `<b>${C3_WORDS}.</b> <span class="muted">${esc(c3Values(m))}</span>`)).join("")}</ul></div>` : ""}
      ${open.length ? `<div class="sec"><h2 class="h">Not traced <small>${open.length}</small></h2><ul class="attn">${open.map((u) => goRow(u.node, "ungrounded", `${NOT_TRACED[u.kind]}${u.kind === "bare" && u.node ? ` in ${esc(u.node)}` : ""}: ${esc(u.text ?? "")}`)).join("")}</ul></div>` : ""}
      <p class="prompt">${ICON.point}<span>Click any number, sentence, table or chart in the report to see how it was computed.</span></p>`;
}

// ---------- the status bar ----------
// Left: what check said. Middle: what the report holds. Right: what is
// selected, or a passing message ("Copied to the clipboard").
const many = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
function holds() {
  const { numbers, claims, views, sources } = reportCounts(S.fx);
  return [
    many(numbers, "number"),
    many(claims, "claim"),
    many(views, "view"),
    many(sources, "source"),
  ].join(" · ");
}
function here({ id, kind, value, name }) {
  const what =
    value === null
      ? esc(name ?? "")
      : `<b>${esc(value)}</b> ${esc(name ?? "")}`;
  return `<span class="here" title="${esc(kind)} ${esc(id)}: ${esc(name ?? "")}"><span class="here-id">${esc(id)}</span><span class="kind">${esc(kind)}</span><span class="here-what">${what}</span></span><span class="key"><kbd>Esc</kbd> back</span>`;
}
function statusBar() {
  const { line, issues, reason } = checkStatus(S.fx);
  const drawer =
    S.drawer && issues.length
      ? `<ul class="drawer">${issues.map((i) => `<li>${i.node && S.nodes[i.node] ? idBtn(i.node) : ""}<span><b>${esc(i.code)}</b> ${codeify(i.message)}</span></li>`).join("")}</ul>`
      : "";
  const label = `${esc(line)}${issues.length ? ` ${ICON.chev}` : ""}`;
  const check = issues.length
    ? `<button class="link" type="button" data-status aria-expanded="${S.drawer}">${label}</button>`
    : `<span>${label}</span>`;
  const right = S.flash
    ? `<span class="flash${S.flash.warn ? " warn" : ""}">${esc(S.flash.msg)}</span>`
    : S.sel
      ? here(selection(S.fx.graph, S.sel))
      : "";
  return `<div class="statusbar${reason ? " bad" : ""}">${drawer}<div class="bar-line">${check}${reason ? `<span class="reason">${esc(reason)}</span>` : ""}<span class="holds">${holds()}</span><span class="bar-r">${right}</span></div></div>`;
}

// ---------- selected state ----------
function renderSelected(id) {
  const n = S.nodes[id];
  const st = state(id);
  const step = stepWord(id);

  // head: what this is, in plain words
  const meta = `<div class="head-meta"><span class="id static">${esc(id)}</span><span class="kind">${esc(step)}</span><span class="state">${sw(st)}${esc(STATE_WORD[groundOf(S.fx, id)])}</span></div>`;
  let head = `<div class="head">`;
  if (n.step === "figure") {
    head += `<p class="value">${esc(val(id))}</p><p class="label">${n.label ? esc(n.label) : `<span class="muted">No label was recorded for this number.</span>`}</p>${meta}`;
  } else if (n.step === "insight") {
    let text = esc(n.text);
    for (const p of n.from || []) {
      const d = val(p);
      if (d && S.nodes[p]?.step === "figure")
        text = text.split(esc(d)).join(`<mark>${esc(d)}</mark>`);
    }
    head += `<p class="claim">${text}</p>${meta}`;
  } else if (n.step === "view") {
    head += `<p class="claim">${esc(nameOf(id))}</p><p class="label muted">${esc(visual(id))} · ${(n.columns || []).length} columns</p>${meta}`;
  } else {
    head += `<p class="claim"><code>${wb(nameOf(id))}</code></p><p class="label muted">${n.kind === "sql" ? esc(period(n.period)) : esc(n.given || "")}</p>${meta}`;
  }
  const c3 = mismatches(S.fx).find((m) => m.node === id);
  if (c3)
    head += `<p class="c3"><b>${C3_WORDS}.</b> <span>${esc(c3Values(c3))}</span></p>`;
  head += `<div class="head-act">
      ${copyBtn("data-copy-chain", id, chainSql(S.fx, id), `Copy SQL for this ${n.step === "insight" ? "claim" : n.step}`, "Every query this rests on, composed into one runnable script")}
      ${pageCount(id) ? `<button class="btn" type="button" data-scroll="${esc(id)}">${ICON.page}Show on the page</button>` : ""}
    </div></div>`;

  // built from: the sources under this node
  const sources = builtFrom(S.fx, id);
  const rests = sources.length
    ? `<div class="rests"><h2 class="h">Built from</h2><ul>${sources.map((r) => sourceRow(r, { count: false })).join("")}</ul></div>`
    : "";

  // used by: the same outline, going up
  const users = outline(S.fx.graph, [id], { up: true }).rows.length;
  const uses = `<div class="uses">${
    users
      ? `<button class="btn" type="button" data-uses aria-expanded="${S.showUses}">${S.showUses ? ICON.caret.replace("M2.5 7.5 6 4l3.5 3.5", "M2.5 4.5 6 8l3.5-3.5") : ICON.caret}${S.showUses ? "Hide what uses this" : `Show what uses this (${users})`}</button>`
      : `<button class="btn" type="button" disabled>Nothing else uses this</button>`
  }</div>`;
  const usesList =
    S.showUses && users
      ? `<div class="ol-sec">${rowsHtml([id], true)}</div>`
      : "";

  // how it was computed: the clicked step's own card, then its inputs
  const keys = outlineKeys(S.fx.graph, id);
  const allOpen = keys.every((k) => S.openDown.has(k));
  const openAll = keys.length
    ? `<button class="link" type="button" data-openall="${allOpen ? "" : "1"}">${allOpen ? "Close all" : "Open all"}</button>`
    : "";
  // a claim with no card of its own still shows its transform note
  const { note } = stepText(S.fx.graph, id);
  const own = ownCard(S.fx.graph, id)
    ? `<div class="ol-own">${stepCard(id, { isTop: true })}</div>`
    : note
      ? `<div class="ol-own"><div class="card"><p class="reads"><b>Note</b> ${esc(note)}</p></div></div>`
      : "";
  const score = `<div class="score-h"><h2 class="h">How it was computed</h2>${openAll}</div>
    <div class="ol-sec">${own}${rowsHtml([id], false)}</div>`;

  return head + rests + uses + usesList + score;
}

// ---------- render ----------
function nav() {
  if (!S.sel) return "";
  const prev = S.history[S.history.length - 1];
  const backLabel = prev ? `Back to ${prev}` : "Summary";
  return `<div class="nav"><button class="back" type="button" data-back>${ICON.back}${esc(backLabel)}</button><span class="gap"></span>${
    prev
      ? `<button class="link" type="button" data-home style="font-size:13px">Report summary</button>`
      : ""
  }</div>`;
}

// Redrawing in place keeps keyboard focus on the button that was pressed. A
// toggle only adds or removes what comes after it, so that button keeps its
// place among the panel's buttons.
function render({ keepScroll = false } = {}) {
  const pane = $("#lineage");
  const top = pane.scrollTop;
  const buttons = () => [...pane.querySelectorAll("button")];
  const focused = keepScroll ? buttons().indexOf(document.activeElement) : -1;
  pane.innerHTML = nav() + (S.sel ? renderSelected(S.sel) : renderSummary());
  paintStatus();
  pane.scrollTop = keepScroll ? top : 0;
  if (focused >= 0) buttons()[focused]?.focus({ preventScroll: true });
  paintPage();
  writeHash();
}

// ---------- the report pane ----------
// The report runs in a sandboxed frame; the panel and the bridge script the
// server adds to it talk only through messages.
const tell = (message) =>
  $("#report").contentWindow?.postMessage(
    { trailline: message.type, ...message },
    "*",
  );

function mountReport() {
  window.addEventListener("message", (e) => {
    if (e.source !== $("#report").contentWindow) return;
    const message = fromReport(S.fx, e.data);
    if (message === null) return;
    if (message.type === "select") select(message.id, { fromPage: true });
    else if (message.type === "back") back();
    else onPageReady(message.counts);
  });
  $("#report").src = `/report/${encodeURIComponent(S.fx.report)}`;
}

function paintPage() {
  tell({ type: "mark", id: S.sel });
}

function scrollPage(id) {
  const n = pageCount(id);
  if (!n) return;
  const k = (S.cycle[id] = ((S.cycle[id] ?? -1) + 1) % n);
  tell({ type: "scroll", id, index: k });
  if (n > 1) toast(`${k + 1} of ${n} places on the page`);
}

function peek(id, on) {
  tell({ type: "peek", id: on && id !== S.sel ? id : null });
}

// ---------- actions ----------
function select(id, { fromPage = false, push = true } = {}) {
  if (!S.nodes[id]) return;
  if (S.sel && push && S.sel !== id) S.history.push(S.sel);
  if (!S.sel && push) S.history = [];
  S.sel = id;
  startOver();
  render();
  if (!fromPage && pageCount(id)) {
    S.cycle[id] = -1;
    scrollPage(id);
  }
}
function back() {
  if (!S.sel) return;
  const prev = S.history.pop();
  if (prev) {
    S.sel = prev;
    startOver();
    render();
    if (pageCount(prev)) {
      S.cycle[prev] = -1;
      scrollPage(prev);
    }
  } else home();
}
function home() {
  S.sel = null;
  S.history = [];
  startOver();
  render();
}

// The old way to copy, for when the Clipboard API is missing or refuses.
function execCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    ta.remove();
  }
}

async function copy(text, btn) {
  if (!(await copyText(text, { clipboard: navigator.clipboard, execCopy }))) {
    return toast("Could not copy to the clipboard", { warn: true });
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.classList.add("done");
    btn.innerHTML = btn.innerHTML.replace(/Copy[^<]*/, "Copied");
    setTimeout(() => {
      btn.classList.remove("done");
      btn.innerHTML = old;
    }, 1400);
  }
  toast("Copied to the clipboard");
}

// The status bar is drawn again when the selection or a message changes;
// keyboard focus on its button stays put.
function paintStatus() {
  const status = $("#status");
  const focused = status.contains(document.activeElement);
  status.innerHTML = statusBar();
  if (focused) $("[data-status]", status)?.focus({ preventScroll: true });
}

// A message at the right of the status bar for a moment, read out by the live
// region beside it. A failure is styled as a warning. The region is emptied
// first so that the same message twice is announced twice.
let flashT;
let sayT;
function toast(msg, { warn = false } = {}) {
  S.flash = { msg, warn };
  const say = $("#say");
  say.textContent = "";
  clearTimeout(sayT);
  sayT = setTimeout(() => (say.textContent = msg), 50);
  paintStatus();
  clearTimeout(flashT);
  flashT = setTimeout(() => {
    S.flash = null;
    paintStatus();
  }, 1800);
}

// ---------- events in the panel ----------
const pane = $("#lineage");
const onClick = (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.go) return select(t.dataset.go);
  if (t.hasAttribute("data-status")) {
    S.drawer = !S.drawer;
    return render({ keepScroll: true });
  }
  if (t.hasAttribute("data-back")) return back();
  if (t.hasAttribute("data-home")) return home();
  if (t.dataset.sql) {
    const id = t.dataset.sql;
    const { show } = stepText(S.fx.graph, id);
    S.sqlOpen.set(id, !(S.sqlOpen.get(id) ?? show.open));
    return render({ keepScroll: true });
  }
  if (t.dataset.copySql) return copy(stepSql(S.fx, t.dataset.copySql).sql, t);
  if (t.dataset.copyChain)
    return copy(chainSql(S.fx, t.dataset.copyChain).sql, t);
  if (t.dataset.scroll) return scrollPage(t.dataset.scroll);
  if (t.hasAttribute("data-uses")) {
    S.showUses = !S.showUses;
    return render({ keepScroll: true });
  }
  if (t.dataset.tog) {
    const opened = t.hasAttribute("data-up") ? S.openUp : S.openDown;
    const key = t.dataset.tog;
    opened.has(key) ? opened.delete(key) : opened.add(key);
    return render({ keepScroll: true });
  }
  if (t.hasAttribute("data-openall")) {
    for (const key of outlineKeys(S.fx.graph, S.sel))
      t.dataset.openall ? S.openDown.add(key) : S.openDown.delete(key);
    return render({ keepScroll: true });
  }
};
pane.addEventListener("click", onClick);
$("#status").addEventListener("click", onClick);
// hovering a row outlines its step on the page
pane.addEventListener("mouseover", (e) => {
  const row = e.target.closest("[data-row]");
  peek(row?.dataset.row, Boolean(row));
});
pane.addEventListener("mouseleave", () => peek(null, false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.target.closest("input, select, textarea"))
    back();
});
$("[data-home]").addEventListener("click", (e) => {
  e.preventDefault();
  home();
});
$("#copyReport").addEventListener("click", (e) =>
  copy(reportSql(S.fx).sql, e.currentTarget),
);

// ---------- hash (for links) ----------
const H = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
function writeHash() {
  const p = new URLSearchParams();
  if (S.sel) p.set("sel", S.sel);
  history.replaceState(null, "", `#${p}`);
}
let ready = null;
// The report has loaded: now the panel knows where each node is on the page.
function onPageReady(counts) {
  S.counts = counts;
  const r = ready;
  ready = null;
  if (r?.sel && S.nodes[r.sel]) select(r.sel, { push: false });
  else render({ keepScroll: true });
}

async function boot() {
  const res = await fetch("/data.json");
  if (!res.ok) {
    $("#lineage").textContent = await res.text();
    return;
  }
  load(await res.json());
  $("#reportName").textContent = S.fx.report;
  document.title = `${S.fx.report} · Trailline`;
  const all = reportSql(S.fx);
  const btn = $("#copyReport");
  btn.disabled = all.sql === null;
  btn.title = all.reason ?? "";
  render();
  mountReport();
}

// light or dark: follows the OS until the reviewer picks one
const root = document.documentElement;
const setMode = (m) => {
  root.dataset.theme = m === "dark" ? "console" : "console-light";
};
let saved = null;
try {
  saved = localStorage.getItem("tl-mode");
} catch {
  /* private mode */
}
if (H.mode) saved = H.mode;
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!saved) setMode(e.matches ? "dark" : "light");
});
$("#mode").addEventListener("click", () => {
  saved = root.dataset.theme === "console" ? "light" : "dark";
  setMode(saved);
  try {
    localStorage.setItem("tl-mode", saved);
  } catch {
    /* private mode */
  }
});
ready = H;
boot();
