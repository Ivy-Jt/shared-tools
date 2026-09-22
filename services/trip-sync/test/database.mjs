import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function testDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0001_state.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; }, async first() { return sqlite.prepare(sql).get(...values) || null; } };
    }
  };
}
