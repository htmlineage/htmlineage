import { commands } from "./commands/index.js";
import { packageMeta } from "./meta.js";

export function topLevelHelp() {
  const width = Math.max(...commands.map((c) => c.name.length));
  const lines = commands.map((c) => `  ${c.name.padEnd(width)}   ${c.summary}`);
  return `htmlineage — a provenance layer for AI-generated reports

Usage
  htmlineage <command> [options]

Commands
${lines.join("\n")}

Options
  -h, --help      Show this help, or help for a command
  -v, --version   Print the version

Run \`htmlineage <command> --help\` for the options of one command.`;
}

export function versionLine() {
  const { name, version } = packageMeta();
  return `${name} ${version}`;
}
