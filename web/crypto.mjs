import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// Preserve the Node identity algorithm exactly in the browser.
export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new Error('Unsupported identity algorithm');
  let source = '';
  return { update(value) { source += value; return this; }, digest(encoding) {
    if (encoding !== 'hex') throw new Error('Expected hex identity');
    return bytesToHex(sha256(new TextEncoder().encode(source)));
  } };
}
