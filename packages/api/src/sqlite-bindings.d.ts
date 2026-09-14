// O runtime do Bun aceita bindings tanto na forma variádica
// (`db.run(sql, a, b)`) quanto na forma de array único (`db.run(sql, [a, b])`),
// mas `bun-types` declara apenas a segunda. Sem este overload, toda chamada
// variádica do projeto falha com TS2345.
declare module "bun:sqlite" {
  interface Database {
    run(
      sql: string,
      ...bindings: Array<
        string | number | bigint | boolean | null | Uint8Array | ArrayBuffer
      >
    ): { changes: number; lastInsertRowid: number | bigint };
  }
}
