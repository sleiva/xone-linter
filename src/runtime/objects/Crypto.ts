import { createHash, createHmac } from 'node:crypto';
import type { RuntimeLog } from '../RuntimeLog.js';

/**
 * Corte #40 — el objeto `crypto` de XOne toma un **NativeObject** como único argumento, NO un
 * string suelto, y devuelve un digest REAL.
 *
 * Fuente: skill `xone-help-docs`, `topics/06-javascript-runtime-objects.md` §6.2 (referencia
 * autorizada de plataforma según `CLAUDE.md`):
 *
 *   «Casi todos los métodos toman un único `NativeObject` como argumento (NO strings sueltos):
 *    `{ data: "...", outputFormat: "hex"|"base64"|"buffer", key?: "hmacKey", output?: "f.bin" }`»
 *   «var hashBuffer = crypto.sha512({ data: "texto" });   // outputFormat por defecto "buffer"»
 *   «AVISO: `crypto.md5("texto")` con un String literal **lanza `ClassCastException`**.»
 *
 * Ese aviso es lo que fija la conducta ante un string: LANZAR. El simulador es también un
 * validador para quien escribe la app; tragárselo escondería un fallo que en device peta.
 *
 * Antes de este corte la firma estaba invertida (aceptaba el string, reventaba con el objeto) y
 * el digest era un placeholder `md5_<base64>`, que no autentica contra ningún servidor. Lo
 * destapó `AliviaApp/authFunctions.js:76-83` (`encodePass`), la puerta del login real.
 */

export type CryptoOutputFormat = 'hex' | 'base64' | 'buffer';

export interface CryptoArgs {
  data: string;
  /** Default del oráculo: `"buffer"`. */
  outputFormat?: CryptoOutputFormat;
  /** Presente ⇒ el digest es un HMAC con esta clave. */
  key?: string;
}

/** Los seis hashes que expone el oráculo, todos con el mismo resolvedor de argumento. */
const HASH_ALGOS = {
  md5: 'md5', sha1: 'sha1', sha224: 'sha224',
  sha256: 'sha256', sha384: 'sha384', sha512: 'sha512',
} as const;

export class Crypto {
  constructor(private readonly log: RuntimeLog) {}

  md5(args: CryptoArgs): string | Buffer { return this.digest('md5', args); }
  sha1(args: CryptoArgs): string | Buffer { return this.digest('sha1', args); }
  sha224(args: CryptoArgs): string | Buffer { return this.digest('sha224', args); }
  sha256(args: CryptoArgs): string | Buffer { return this.digest('sha256', args); }
  sha384(args: CryptoArgs): string | Buffer { return this.digest('sha384', args); }
  sha512(args: CryptoArgs): string | Buffer { return this.digest('sha512', args); }

  /** Mismo objeto-argumento que los hashes (skill §6.2: `crypto.toBase64({data, outputFormat})`). */
  toBase64(args: CryptoArgs): string {
    const { data } = this.parseArgs('toBase64', args);
    return Buffer.from(data, 'utf-8').toString('base64');
  }

  fromBase64(args: CryptoArgs): string {
    const { data } = this.parseArgs('fromBase64', args);
    return Buffer.from(data, 'base64').toString('utf-8');
  }

  aesEncrypt(_input: string, _key: string): string {
    this.log.push('custom', 'crypto.aesEncrypt(...)');
    return 'AES_MOCK';
  }

  aesDecrypt(_input: string, _key: string): string {
    this.log.push('custom', 'crypto.aesDecrypt(...)');
    return 'AES_MOCK';
  }

  /**
   * Resolvedor único del objeto-argumento. Lanza igual que el `ClassCastException` del oráculo
   * cuando le llega un string suelto o un objeto sin `data`.
   */
  private parseArgs(method: string, args: CryptoArgs): Required<Pick<CryptoArgs, 'data'>> & {
    outputFormat: CryptoOutputFormat; key?: string;
  } {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      throw new TypeError(
        `crypto.${method} espera un objeto { data, outputFormat }, no ${typeof args}. ` +
        `En el dispositivo esto lanza ClassCastException (skill xone-help-docs §6.2).`,
      );
    }
    const { data, outputFormat, key } = args;
    if (data === undefined || data === null) {
      throw new TypeError(`crypto.${method}: falta la clave \`data\` en el objeto-argumento.`);
    }
    return { data: String(data), outputFormat: outputFormat ?? 'buffer', key };
  }

  private digest(method: keyof typeof HASH_ALGOS, args: CryptoArgs): string | Buffer {
    const { data, outputFormat, key } = this.parseArgs(method, args);
    const algo = HASH_ALGOS[method];
    // `key` presente ⇒ HMAC (skill §6.2: «HMAC: añadir la clave en `key`»).
    const h = key !== undefined && key !== null
      ? createHmac(algo, String(key)).update(data, 'utf-8')
      : createHash(algo).update(data, 'utf-8');
    this.log.push('custom', `crypto.${method}({data:"${data}"${key !== undefined ? ', key:…' : ''}, outputFormat:"${outputFormat}"})`);
    return outputFormat === 'buffer' ? h.digest() : h.digest(outputFormat);
  }
}
