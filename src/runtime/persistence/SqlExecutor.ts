/**
 * Sustituye macros del sistema en cadenas SQL, de forma similar al runtime XOne.
 */
export class SqlExecutor {
  private macros = new Map<string, string>();

  setMacro(name: string, value: string): void {
    this.macros.set(name, value);
  }

  prepareSql(sql: string, prefix: string): string {
    let result = sql;
    for (const [name, value] of this.macros.entries()) {
      result = result.replaceAll(name, value);
    }
    // ##PREF##Tabla -> gen_Tabla
    result = result.replace(/##PREF##([A-Za-z0-9_]+)/g, `${prefix}_$1`);
    return result;
  }

  setGlobalMacros(macros: Record<string, string>): void {
    for (const [k, v] of Object.entries(macros)) {
      this.macros.set(k, v);
    }
  }
}
