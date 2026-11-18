import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(orchestration_command_receipts)
  `;
  // Earlier receipts keep NULL: their issuer is unknown.
  if (!columns.some((column) => column.name === "issuer_json")) {
    yield* sql`
      ALTER TABLE orchestration_command_receipts
      ADD COLUMN issuer_json TEXT
    `;
  }
});
