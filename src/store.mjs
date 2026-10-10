import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StoreBase } from './store-base.mjs';
export { digest } from './digest.mjs';
export class Store extends StoreBase {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    super(new DatabaseSync(path));
  }
}
