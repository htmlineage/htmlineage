/**
 * The viewer's logic with no page in it: chain layout, trace state, titles,
 * grounding, SQL highlighting, the status bar and what the copy buttons copy. An
 * ES module with no imports, so the page and the tests load the same file.
 */

/** True for a plain object: not null, not an array. */
const isObject = (x) =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** A graph's nodes as an object, whatever the graph is. */
export function nodesOf(graph) {
  if (!isObject(graph) || !isObject(graph.nodes)) return {};
  return Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([, node]) => isObject(node))
      .map(([id, node]) => [
        id,
        "from" in node && !Array.isArray(node.from)
          ? { ...node, from: [] }
          : node,
      ]),
  );
}

/** The trace state of a node, or "ungrounded" for an id not in the graph. */
export function nodeState(data, id) {
  if (!data.graph.nodes[id]) return "ungrounded";
  return data.trace[id] || "partial";
}

/**
 * Every node under `id`, `id` included, and whether the walk met a cycle or a
 * missing parent on the way.
 */
function underneath(nodes, id) {
  const seen = new Set();
  const path = new Set();
  let broken = false;
  const walk = (x) => {
    if (!nodes[x] || path.has(x)) return void (broken = true);
    if (seen.has(x)) return;
    seen.add(x);
    path.add(x);
    for (const parent of nodes[x].from ?? []) walk(parent);
    path.delete(x);
  };
  walk(id);
  return { ids: [...seen], broken };
}

/**
 * How an external source is named in a label: by its type, as a tag.
 * @param {unknown} type
 * @returns {string}
 */
export function externalTag(type) {
  return typeof type === "string" && type.trim()
    ? `${type} source`
    : "outside source";
}

/**
 * What a node rests on: "sql" when its trace is full, "file" when an external
 * source is under it, else "none". A cycle, a missing parent or an ungrounded
 * node with no file under it rests on nothing.
 * @returns {"sql" | "file" | "none"}
 */
export function groundOf(data, id) {
  const nodes = nodesOf(data.graph);
  if (!nodes[id]) return "none";
  if (data.trace[id] === "full") return "sql";
  if (data.trace[id] === "ungrounded") return "none";
  const { ids, broken } = underneath(nodes, id);
  if (broken) return "none";
  const file = ids.some(
    (x) => nodes[x].step === "source" && nodes[x].kind === "external",
  );
  return file ? "file" : "none";
}

/**
 * How much of the report rests on what. Numbers are the figures plus each
 * bare number check found; claims are the insights.
 * @returns {{ numbers: { sql: number, file: number, none: number }, claims: { supported: number, unsupported: number } }}
 */
export function grounding(data) {
  const numbers = { sql: 0, file: 0, none: 0 };
  const claims = { supported: 0, unsupported: 0 };
  for (const [id, node] of Object.entries(nodesOf(data.graph))) {
    const ground = groundOf(data, id);
    if (node.step === "figure") numbers[ground]++;
    if (node.step === "insight") {
      claims[ground === "none" ? "unsupported" : "supported"]++;
    }
  }
  numbers.none += data.summary.issues.filter((i) => i.code === "C2").length;
  return { numbers, claims };
}

/**
 * The grounding counts as two plain-text lines, or null for a part with
 * nothing in it.
 * @returns {{ numbers: string | null, claims: string | null }}
 */
export function headline({ numbers, claims }) {
  const plural = (n, one, many) => (n === 1 ? one : many);
  const nTotal = numbers.sql + numbers.file + numbers.none;
  const cTotal = claims.supported + claims.unsupported;
  const out = { numbers: null, claims: null };
  if (nTotal) {
    out.numbers =
      numbers.sql === nTotal
        ? nTotal === 1
          ? "1 number traces to the warehouse."
          : `All ${nTotal} numbers trace to the warehouse.`
        : [
            `${numbers.sql} of ${nTotal} numbers ${plural(numbers.sql, "traces", "trace")} to the warehouse.`,
            numbers.file &&
              `${numbers.file} ${plural(numbers.file, "rests on an outside source", "rest on outside sources")}.`,
            numbers.none &&
              `${numbers.none} ${plural(numbers.none, "has nothing behind it", "have nothing behind them")}.`,
          ]
            .filter(Boolean)
            .join(" ");
  }
  if (cTotal) {
    out.claims =
      claims.supported === cTotal
        ? cTotal === 1
          ? "1 claim is supported."
          : `All ${cTotal} claims are supported.`
        : `${claims.supported} of ${cTotal} claims ${plural(claims.supported, "is", "are")} supported. ${claims.unsupported} ${plural(claims.unsupported, "is", "are")} stated without support.`;
  }
  return out;
}

/**
 * Whether check left a sql source's period pinned. Any C7 on it is a problem
 * with the period except one that is only about `mart` or `columns`; C7's
 * message parts are fixed strings, joined with "; ".
 */
function isPinned(data, id) {
  const aboutPeriod = (part) => {
    const missing = /^sql source is missing (.*)$/.exec(part);
    if (!missing) return true;
    return /`(period|sql)`/.test(missing[1]);
  };
  return !data.summary.issues
    .filter((i) => i.code === "C7" && i.node === id)
    .some((i) => i.message.split("; ").some(aboutPeriod));
}

/**
 * One row per source: what it is, its period, whether check found its period
 * unpinned (a C7), and how many figures rest on it at any depth.
 * @returns {({ node: string, kind: "sql", name: string | null, period: object | null, pinned: boolean, numbers: number } | { node: string, kind: "external", name: string | null, numbers: number })[]}
 */
export function builtOn(data) {
  const nodes = nodesOf(data.graph);
  const figures = Object.keys(nodes).filter(
    (id) => nodes[id].step === "figure",
  );
  return Object.entries(nodes)
    .filter(([, node]) => node.step === "source")
    .map(([id, node]) => {
      const numbers = figures.filter((f) =>
        underneath(nodes, f).ids.includes(id),
      ).length;
      if (node.kind !== "sql") {
        return { node: id, kind: "external", name: node.ref ?? null, numbers };
      }
      return {
        node: id,
        kind: "sql",
        name: node.mart ?? null,
        period: node.period ?? null,
        pinned: isPinned(data, id),
        numbers,
      };
    });
}

/** The rows of `builtOn` for the sources under `id`, `id` included. */
export function builtFrom(data, id) {
  const under = underneath(nodesOf(data.graph), id).ids;
  return builtOn(data).filter((row) => under.includes(row.node));
}

/** Where the page and the graph differ: one row per C3, in check's order. */
export function mismatches(data) {
  return data.summary.issues
    .filter((i) => i.code === "C3")
    .map(({ node, message }) => {
      const read =
        /^page shows ((?:"[^"]*"(?:, )?)+) but (?:display is "(.*)"|value is (.*))$/.exec(
          message,
        );
      if (!read) return { node, page: [], graph: null };
      return {
        node,
        page: [...read[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]),
        graph: read[2] ?? read[3],
      };
    });
}

/**
 * Numbers and claims with nothing behind them: figures, then bare numbers,
 * then claims.
 * @returns {{ node: string | null, kind: "figure" | "bare" | "claim", text: string | null }[]}
 */
export function untraced(data) {
  const nodes = Object.entries(nodesOf(data.graph));
  const none = (step) =>
    nodes.filter(
      ([id, node]) => node.step === step && groundOf(data, id) === "none",
    );
  const bare = data.summary.issues
    .filter((i) => i.code === "C2")
    .map(({ node, message }) => ({
      node,
      kind: "bare",
      text: /^bare number "(.*)" is not/.exec(message)?.[1] ?? message,
    }));
  return [
    ...none("figure").map(([node, n]) => ({
      node,
      kind: "figure",
      text: n.display ?? null,
    })),
    ...bare,
    ...none("insight").map(([node, n]) => ({
      node,
      kind: "claim",
      text: n.text ?? null,
    })),
  ];
}

/**
 * The status bar's text, every issue for the drawer (errors first), and why
 * copying is off.
 * @returns {{ line: string, issues: object[], reason: string | null }}
 */
export function checkStatus(data) {
  const all = data.summary.issues;
  const errors = all.filter((i) => i.severity === "error");
  const notes = all.filter((i) => i.severity !== "error");
  const count = (list, one, many) =>
    list.length && `${list.length} ${list.length === 1 ? one : many}`;
  const parts = [
    count(errors, "error", "errors"),
    count(notes, "note", "notes"),
  ];
  return {
    line: ["check", ...(all.length ? parts.filter(Boolean) : ["clean"])].join(
      " · ",
    ),
    issues: [...errors, ...notes],
    reason: data.refused,
  };
}

/** A short plain-text name for a node. */
export function title(graph, id) {
  const node = graph.nodes[id];
  if (!node) return "Not in the graph";
  if (node.step === "figure") return node.label;
  if (node.step === "view") {
    return leadingComment(node.sql) || node.encoding?.visual || "view";
  }
  if (node.step === "insight") return node.text;
  return node.kind === "sql" ? node.mart : node.ref;
}

/** The text of a SQL script's first line when it is a `--` comment. */
function leadingComment(sql) {
  const match = /^\s*--\s*(.+)/.exec(sql || "");
  return match ? match[1].trim() : "";
}

/**
 * A node's parents, each once; a `from` that is not a list (check's S4) has
 * none.
 */
const parentsOf = (graph, x) => {
  const from = graph.nodes[x]?.from;
  return Array.isArray(from) ? [...new Set(from)] : [];
};

// Each graph's users of every node, built the first time it is asked for.
const USERS = new WeakMap();

/** The nodes whose `from` names `x`, in graph order. */
function usersOf(graph, x) {
  if (!USERS.has(graph)) {
    const users = new Map();
    for (const id of Object.keys(graph.nodes))
      for (const p of parentsOf(graph, id))
        users.set(p, [...(users.get(p) ?? []), id]);
    USERS.set(graph, users);
  }
  return USERS.get(graph).get(x) ?? [];
}

/**
 * The rows under one step of the outline. `branch` is the clicked node, then
 * each opened row down to the step whose rows are wanted.
 * @returns {{ label: string | null, rows: { id: string, key: string, loop: boolean }[] }}
 */
export function outline(graph, branch, { up = false } = {}) {
  const last = branch.at(-1);
  const next = up ? usersOf(graph, last) : parentsOf(graph, last);
  const rows = next.map((id) => ({
    id,
    key: JSON.stringify([...branch.slice(1), id]),
    loop: branch.includes(id),
  }));
  const word = up ? "Used by" : "Rests on";
  return {
    label: rows.length
      ? `${word}${rows.length > 1 ? ` ${rows.length}` : ""}`
      : null,
    rows,
  };
}

// Each graph's "Open all" keys by clicked step: one key per path below it, so
// they are walked once, not on every render.
const KEYS = new WeakMap();

/** The keys "Open all" opens: every row under `id`, going down. */
export function outlineKeys(graph, id) {
  if (!KEYS.has(graph)) KEYS.set(graph, new Map());
  const keys = KEYS.get(graph);
  const walk = (branch) =>
    outline(graph, branch)
      .rows.filter((r) => !r.loop)
      .flatMap((r) => [r.key, ...walk([...branch, r.id])]);
  if (!keys.has(id)) keys.set(id, walk([id]));
  return keys.get(id);
}

/**
 * Whether the clicked step shows its own card: not a claim that rests on
 * something, whose card would only list the rows below it.
 */
export function ownCard(graph, id) {
  return !(
    graph.nodes[id]?.step === "insight" && parentsOf(graph, id).length > 0
  );
}

/**
 * What a row says about one step: its kind, title and value, and the names of
 * the sources it ends at.
 * @returns {{ id: string, kind: string, title: string | null, value: string | null, onPage: boolean, ends: string[], note: string | null }}
 */
export function inputRow(data, id, { onPage = [] } = {}) {
  const { kind, title, value } = stepHead(data.graph, id);
  const nodes = nodesOf(data.graph);
  const under = new Set(underneath(nodes, id).ids);
  const ends = Object.keys(nodes)
    .filter((x) => under.has(x) && nodes[x].step === "source")
    .map((x) => (nodes[x].kind === "sql" ? nodes[x].mart : nodes[x].ref) ?? x);
  const note = !nodes[id]
    ? "not in the graph"
    : !ends.length && !parentsOf(data.graph, id).length
      ? "nothing behind it"
      : null;
  return { id, kind, title, value, onPage: onPage.includes(id), ends, note };
}

/** A string with something in it, else null. */
const words = (x) => (typeof x === "string" && x.trim() ? x : null);

/**
 * What a step says about itself in words, and its SQL toggle: `show` is null
 * when the step has no SQL to show. `label` is the word the panel prints.
 * @returns {{ desc: string | null, note: string | null, show: { label: string, open: boolean } | null }}
 */
export function stepText(graph, id) {
  const node = nodesOf(graph)[id];
  if (!node) return { desc: null, note: null, show: null };
  // An external source says what it is in `given`, an insight in `text`.
  const described = node.step !== "insight" && node.kind !== "external";
  const desc = described ? words(node.desc) : null;
  const note = words(node.transform);
  // A formula is its own calculation, so it has no SQL to toggle.
  if (words(node.sql) === null) return { desc, note, show: null };
  const label = node.step === "source" ? "query" : "SQL";
  return { desc, note, show: { label, open: desc === null } };
}

/** A figure's display, else its value as a string, else null. */
const valueOf = (node) =>
  node.display ?? (node.value == null ? null : String(node.value));

/** The word for each kind of step; "Missing" for an id not in the graph. */
const kindOf = (node) =>
  ({
    source: "Source",
    view: "View",
    figure: "Figure",
    insight: "Claim",
  })[node?.step] ?? "Missing";

/**
 * A step's title line: its kind word, its title and the line under it, and
 * the value at its right. The clicked step (`top`) drops the kind and value,
 * which the panel's head shows.
 * @returns {{ kind: string | null, title: string | null, sub: string | null, value: string | null }}
 */
export function stepHead(graph, id, { top = false } = {}) {
  const node = nodesOf(graph)[id];
  const { desc } = stepText(graph, id);
  const external = node?.kind === "external";
  if (top) {
    // With no words of its own, point at the SQL, which is open.
    const sql = node?.step === "source" ? "query" : "SQL";
    const pointer = stepText(graph, id).show
      ? `${node.step === "source" ? "Fetched" : "Worked out"} by the ${sql} below.`
      : null;
    const title = (external ? words(node.given) : desc) ?? pointer;
    return { kind: null, title, sub: null, value: null };
  }
  const kind = kindOf(node);
  const value = node?.step === "figure" ? valueOf(node) : null;
  if (node?.step === "source") {
    const sub = external ? words(node.given) : desc;
    return { kind, title: words(title(graph, id)), sub, value };
  }
  return {
    kind,
    title: desc ?? (node ? words(title(graph, id)) : null),
    sub: null,
    value,
  };
}

/**
 * What is selected, for the status bar; null for an id not in the graph.
 * @returns {{ id: string, kind: string, value: string | null, name: string | null } | null}
 */
export function selection(graph, id) {
  const node = nodesOf(graph)[id];
  if (!node) return null;
  const figure = node.step === "figure";
  return {
    id,
    kind: kindOf(node),
    value: figure ? valueOf(node) : null,
    name: figure ? (node.label ?? null) : title(graph, id),
  };
}

/**
 * What the report holds, as the status bar counts it. Numbers are the figures
 * plus each bare number check found.
 * @returns {{ numbers: number, claims: number, views: number, sources: number }}
 */
export function reportCounts(data) {
  const steps = Object.values(nodesOf(data.graph)).map((n) => n.step);
  const count = (step) => steps.filter((s) => s === step).length;
  const bare = data.summary.issues.filter((i) => i.code === "C2").length;
  return {
    numbers: count("figure") + bare,
    claims: count("insight"),
    views: count("view"),
    sources: count("source"),
  };
}

/**
 * The structured facts of a step, one shape per kind of step, read from its
 * fields and never from its `desc`; null for an id not in the graph.
 */
export function stepFacts(data, id) {
  const node = nodesOf(data.graph)[id];
  if (!node) return null;
  const list = (x) => (Array.isArray(x) ? x : []);
  if (node.step === "view") {
    return {
      kind: "view",
      from: list(node.from),
      columns: list(node.columns),
      visual: node.encoding?.visual ?? null,
    };
  }
  if (node.step === "insight") {
    return { kind: "claim", text: node.text ?? null, from: list(node.from) };
  }
  if (node.step === "figure") {
    const shown = {
      value: valueOf(node),
      label: node.label ?? null,
    };
    if (words(node.sql) === null && words(node.expr) !== null) {
      return { kind: "formula", ...shown, expr: node.expr };
    }
    return { kind: "pick", ...shown, from: list(node.from) };
  }
  if (node.kind === "external") {
    return {
      kind: "external",
      ref: node.ref ?? null,
      given: node.given ?? null,
      columns: list(node.columns),
    };
  }
  return {
    kind: "sql",
    mart: node.mart ?? null,
    period: node.period ?? null,
    pinned: isPinned(data, id),
    how: node.how ?? null,
    columns: list(node.columns),
  };
}

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const KEYWORDS =
  /^(select|from|where|and|or|not|group|by|order|join|left|inner|on|as|sum|count|avg|min|max|rank|over|partition|desc|asc|limit|between|in|with|union|all|case|when|then|else|end|null|is|distinct|having|dateadd|current_date)$/i;

/** SQL as HTML, with keywords, strings, comments and numbers in spans. */
export function highlightSql(sql) {
  return sql
    .split(/('(?:[^']|'')*'|--[^\n]*|\b\w+\b)/)
    .map((token, k) => {
      if (k % 2 === 0) return escapeHtml(token);
      if (token.startsWith("'")) {
        return `<span class="str">${escapeHtml(token)}</span>`;
      }
      if (token.startsWith("--")) {
        return `<span class="cm">${escapeHtml(token)}</span>`;
      }
      if (/^\d+$/.test(token)) return `<span class="num">${token}</span>`;
      return KEYWORDS.test(token) ? `<span class="kw">${token}</span>` : token;
    })
    .join("");
}

/**
 * What a copy button copies. Exactly one of `sql` and `reason` is null: a
 * report that fails check copies nothing, and says why.
 * @returns {{ sql: string | null, reason: string | null }}
 */
function copyable(data, sql) {
  if (data.refused !== null) return { sql: null, reason: data.refused };
  if (!sql) return { sql: null, reason: "Nothing here to run" };
  return { sql, reason: null };
}

/** The whole report composed into one script. */
export function reportSql(data) {
  return copyable(data, data.composedReport);
}

/** The script behind one node and everything it rests on. */
export function chainSql(data, id) {
  return copyable(data, data.composed[id]);
}

/** One step's own SQL. */
export function stepSql(data, id) {
  return copyable(data, data.graph.nodes[id].sql);
}

/**
 * Copy `text`: with the Clipboard API when there is one and it accepts, else
 * with `execCopy`. Resolves whether the text was copied; never rejects.
 * @param {string} text
 * @param {{ clipboard?: { writeText?: (text: string) => Promise<void> }, execCopy: (text: string) => boolean }} how
 * @returns {Promise<boolean>}
 */
export async function copyText(text, { clipboard, execCopy }) {
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    // Also reached when there is no clipboard to call.
    try {
      return execCopy(text);
    } catch {
      return false;
    }
  }
}

/**
 * What a message from the report frame asks the panel to do. A report's own
 * scripts can post anything, so only what a click or a key could do gets
 * through.
 * @returns {{ type: "select", id: string } | { type: "back" } | { type: "ready", counts: object } | null}
 */
export function fromReport(data, message) {
  if (!isObject(message)) return null;
  if (message.lineage === "back") return { type: "back" };
  if (message.lineage === "select") {
    const { id } = message;
    const known =
      typeof id === "string" && Object.hasOwn(nodesOf(data.graph), id);
    return known ? { type: "select", id } : null;
  }
  if (message.lineage === "ready") {
    const nodes = nodesOf(data.graph);
    const counts = isObject(message.counts) ? message.counts : {};
    return {
      type: "ready",
      counts: Object.fromEntries(
        Object.entries(counts).filter(
          ([id, n]) => Object.hasOwn(nodes, id) && Number.isInteger(n) && n > 0,
        ),
      ),
    };
  }
  return null;
}

/** Whether an expression is only numbers, ids, brackets and + - * /. */
export const isArithmetic = (expr) =>
  /^[\w\s.+\-*/()]*$/.test(expr) && !/\w\s*\(/.test(expr);

/**
 * An expression for the formula line: plain arithmetic is spaced and written
 * with − and ×; any other SQL is shown as written. The sign in 1e-3 stays put.
 */
export function tidyExpr(expr) {
  if (!/^[\w\s.+\-*/(),]*$/.test(expr)) return expr;
  return expr
    .replace(
      /\s*([*/]|(?<!\b\d+(?:\.\d*)?[eE])[-+])\s*/g,
      (_, op) => ` ${{ "-": "−", "*": "×" }[op] ?? op} `,
    )
    .trim();
}

/**
 * The tidied expression as { id } and { text } parts, for the formula line.
 * Words inside quotes and function names stay text, even when `isId` says yes.
 */
export function exprParts(expr, isId) {
  const parts = [];
  const pieces = tidyExpr(expr).split(
    /('[^']*'|"[^"]*"|\b[A-Za-z_]\w*\b(?!\s*\())/,
  );
  for (const [k, t] of pieces.entries()) {
    const last = parts.at(-1);
    if (k % 2 && isId(t)) parts.push({ id: t });
    else if (!t) continue;
    else if (last?.text !== undefined) last.text += t;
    else parts.push({ text: t });
  }
  return parts;
}
