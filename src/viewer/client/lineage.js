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

/** Every node under `id`, `id` included; a cycle or missing parent ends the walk. */
function underneath(nodes, id) {
  const seen = new Set();
  const walk = (x) => {
    if (seen.has(x) || !nodes[x]) return;
    seen.add(x);
    for (const parent of nodes[x].from ?? []) walk(parent);
  };
  walk(id);
  return [...seen];
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
  const file = underneath(nodes, id).some(
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
              `${numbers.file} ${plural(numbers.file, "rests", "rest")} on a file.`,
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
 * One row per source: what it is, its period, whether check found its dates
 * unpinned (a C7), and how many figures rest on it at any depth.
 * @returns {({ node: string, kind: "sql", name: string | null, period: object | null, pinned: boolean, numbers: number } | { node: string, kind: "external", name: string | null, numbers: number })[]}
 */
export function builtOn(data) {
  const nodes = nodesOf(data.graph);
  const figures = Object.keys(nodes).filter(
    (id) => nodes[id].step === "figure",
  );
  const unpinned = new Set(
    data.summary.issues.filter((i) => i.code === "C7").map((i) => i.node),
  );
  return Object.entries(nodes)
    .filter(([, node]) => node.step === "source")
    .map(([id, node]) => {
      const numbers = figures.filter((f) =>
        underneath(nodes, f).includes(id),
      ).length;
      if (node.kind !== "sql") {
        return { node: id, kind: "external", name: node.ref ?? null, numbers };
      }
      return {
        node: id,
        kind: "sql",
        name: node.mart ?? null,
        period: node.period ?? null,
        pinned: !unpinned.has(id),
        numbers,
      };
    });
}

/** The rows of `builtOn` for the sources under `id`, `id` included. */
export function builtFrom(data, id) {
  const under = underneath(nodesOf(data.graph), id);
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

/** A node's parents; a `from` that is not a list (check's S4) has none. */
const parentsOf = (graph, x) => {
  const from = graph.nodes[x]?.from;
  return Array.isArray(from) ? from : [];
};

/**
 * The chain under `id` in beats, the clicked node's beat first.
 * @returns {{ n: number, ids: string[] }[]}
 */
export function beats(graph, id) {
  const chain = new Set();
  const walk = (x) => {
    if (chain.has(x)) return;
    chain.add(x);
    for (const parent of parentsOf(graph, x)) walk(parent);
  };
  walk(id);
  // A node is one above its tallest parent. Placing 0 before reading the
  // parents makes a cycle end instead of looping.
  const heights = {};
  const height = (x) => {
    if (heights[x] !== undefined) return heights[x];
    heights[x] = 0;
    const parents = parentsOf(graph, x);
    return (heights[x] = parents.length
      ? 1 + Math.max(...parents.map(height))
      : 0);
  };
  const order = Object.keys(graph.nodes);
  // Ids the graph does not know sort after the ones it does.
  const rank = (x) => (order.includes(x) ? order.indexOf(x) : order.length);
  const found = [];
  for (let k = height(id); k >= 0; k--) {
    const ids = [...chain].filter((x) => height(x) === k);
    ids.sort((a, b) => rank(a) - rank(b));
    if (ids.length) found.push(ids);
  }
  return found.map((ids, k) => ({ n: found.length - k, ids }));
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
  if (message.trailline === "back") return { type: "back" };
  if (message.trailline === "select") {
    const { id } = message;
    const known =
      typeof id === "string" && Object.hasOwn(nodesOf(data.graph), id);
    return known ? { type: "select", id } : null;
  }
  if (message.trailline === "ready") {
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
