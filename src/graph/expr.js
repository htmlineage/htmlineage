/**
 * A figure's `expr`: a SQL scalar expression over figure ids, passed through
 * as written. Trailline has no grammar for it. It only finds the ids the text
 * names as bare words, and says whether the text can be read at all (brackets
 * and quotes close, and no comment).
 */

/**
 * The ids from `ids` that the text names as bare words (not inside quotes,
 * and not a function name before `(`), distinct, in first-seen order.
 */
export function exprRefs(source, ids) {
  const known = new Set(ids);
  const seen = new Set();
  const bare = source.replace(/'[^']*'|"[^"]*"/g, " ");
  for (const [word] of bare.matchAll(/[A-Za-z_][A-Za-z0-9_]*\b(?!\s*\()/g)) {
    if (known.has(word)) seen.add(word);
  }
  return [...seen];
}

/**
 * Whether the text can be read at all: brackets and quotes close, and there
 * is no comment. Returns null, or { message, position } (0-based).
 */
export function exprProblem(source) {
  const open = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "'" || char === '"') {
      const end = source.indexOf(char, i + 1);
      if (end === -1) {
        return { message: `\`${char}\` is never closed`, position: i };
      }
      i = end;
    } else if (source.startsWith("--", i) || source.startsWith("/*", i)) {
      const mark = source.slice(i, i + 2);
      return {
        message: `\`${mark}\` starts a comment; put notes in the node's \`label\``,
        position: i,
      };
    } else if (source[i] === "(") open.push(i);
    else if (source[i] === ")") {
      if (open.length === 0) {
        return { message: "`)` has no matching `(`", position: i };
      }
      open.pop();
    }
  }
  if (open.length > 0) {
    return { message: "`(` is never closed", position: open.pop() };
  }
  return null;
}
