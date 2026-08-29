import { createClient, type Client, type InValue } from "@libsql/client";

type BoundValue = InValue | undefined;

function normalize(value: BoundValue): InValue {
  if (value === undefined) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

class PreparedQuery {
  readonly sql: string;
  readonly args: InValue[];

  constructor(private readonly client: Client, sql: string, args: InValue[] = []) {
    this.sql = sql;
    this.args = args;
  }

  bind(...args: BoundValue[]) {
    return new PreparedQuery(this.client, this.sql, args.map(normalize));
  }

  async first<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T extends Record<string, unknown> = Record<string, unknown>>() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return { results: result.rows as unknown as T[] };
  }

  async run() {
    const result = await this.client.execute({ sql: this.sql, args: this.args });
    return {
      success: true,
      meta: {
        changes: result.rowsAffected,
        last_row_id: result.lastInsertRowid ? Number(result.lastInsertRowid) : undefined,
      },
    };
  }
}

class StablecountDatabase {
  constructor(private readonly client: Client) {}

  prepare(sql: string) {
    return new PreparedQuery(this.client, sql);
  }

  async batch(statements: PreparedQuery[]) {
    const results = await this.client.batch(
      statements.map((statement) => ({ sql: statement.sql, args: statement.args })),
      "write",
    );
    return results.map((result) => ({
      success: true,
      results: result.rows,
      meta: { changes: result.rowsAffected },
    }));
  }
}

const globalDatabase = globalThis as typeof globalThis & {
  stablecountDatabase?: StablecountDatabase;
};

export function database() {
  if (globalDatabase.stablecountDatabase) return globalDatabase.stablecountDatabase;

  const url = process.env.TURSO_DATABASE_URL || "file:stablecount.db";
  if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL is not configured");
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  globalDatabase.stablecountDatabase = new StablecountDatabase(client);
  return globalDatabase.stablecountDatabase;
}

