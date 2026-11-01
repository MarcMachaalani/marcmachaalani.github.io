import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function database() {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(new URL('../../migrations/',import.meta.url)).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8'));
  return {sql,async batch(statements) { sql.exec('BEGIN'); try { const results=[]; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch(error) { sql.exec('ROLLBACK'); throw error; } },prepare(query) { let values = []; const stmt = {bind(...args) { values=args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);return stmt; },async first() { return sql.prepare(query).get(...values) || null; },async all() { return {results:sql.prepare(query).all(...values)}; },async run() { const result=sql.prepare(query).run(...values);return {meta:{changes:Number(result.changes)}}; }};return stmt; }};
}
