import type { DatabaseSync } from "node:sqlite";
import { findSqlClosingParenthesis, normalizeSchemaSql } from "./sqlite-schema-sql.js";

/** Only exact, owned FTS definitions may treat their inverted index as derived data. */
export function classifySqliteFtsIntegrityFindings(
  database: DatabaseSync,
  findings: readonly unknown[],
  schemas: readonly string[],
): string[] | undefined {
  const names = new Set<string>();
  for (const finding of findings) {
    if (finding === "ok") {
      continue;
    }
    const match =
      typeof finding === "string"
        ? /^malformed inverted index for FTS5 table main\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(finding)
        : null;
    if (!match?.[1]) {
      return undefined;
    }
    names.add(match[1]);
  }
  if (names.size === 0) {
    return undefined;
  }
  const definitions = new Map<string, Set<string | null>>();
  for (const schema of schemas) {
    for (const match of schema.matchAll(
      /CREATE VIRTUAL TABLE (?:IF NOT EXISTS )?([A-Za-z_][A-Za-z0-9_]*) USING fts5\s*\(/gu,
    )) {
      const name = match[1]!;
      const end = findSqlClosingParenthesis(schema, match.index + match[0].length - 1);
      const variants = definitions.get(name) ?? new Set<string | null>();
      variants.add(normalizeSchemaSql(schema.slice(match.index, end + 1)));
      definitions.set(name, variants);
    }
  }
  const read = database.prepare("SELECT sql FROM main.sqlite_schema WHERE type='table' AND name=?");
  for (const name of names) {
    const sql = read.get(name)?.sql;
    if (typeof sql !== "string" || !definitions.get(name)?.has(normalizeSchemaSql(sql))) {
      return undefined;
    }
  }
  return [...names].toSorted();
}
