import type { RuntimeLog } from '../RuntimeLog.js';

export class Crypto {
  constructor(private readonly log: RuntimeLog) {}

  md5(input: string): string {
    this.log.push('custom', `crypto.md5("${input}")`);
    return `md5_${Buffer.from(input).toString('base64').slice(0, 8)}`;
  }

  sha1(input: string): string {
    this.log.push('custom', `crypto.sha1("${input}")`);
    return `sha1_${Buffer.from(input).toString('base64').slice(0, 8)}`;
  }

  sha256(input: string): string {
    this.log.push('custom', `crypto.sha256("${input}")`);
    return `sha256_${Buffer.from(input).toString('base64').slice(0, 8)}`;
  }

  base64Encode(input: string): string {
    return Buffer.from(input).toString('base64');
  }

  base64Decode(input: string): string {
    return Buffer.from(input, 'base64').toString('utf-8');
  }

  aesEncrypt(_input: string, _key: string): string {
    this.log.push('custom', 'crypto.aesEncrypt(...)');
    return 'AES_MOCK';
  }

  aesDecrypt(_input: string, _key: string): string {
    this.log.push('custom', 'crypto.aesDecrypt(...)');
    return 'AES_MOCK';
  }
}
