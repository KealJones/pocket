import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { ProjectCore } from './project-core.mjs';
const PACKS = fileURLToPath(new URL('../packs/', import.meta.url));
export class Project extends ProjectCore {
  constructor({ path = ':memory:', packs = PACKS, ...options } = {}) {
    const manifest = JSON.parse(readFileSync(join(packs, 'manifest.json'), 'utf8'));
    if (!manifest.packs?.length) throw new Error('Invalid or empty pack manifest');
    const definitions = {};
    for (const name of manifest.packs) {
      if (name.includes('..') || name.includes('/') || name.includes('\\')) throw new Error('Invalid pack path');
      definitions[name] = readFileSync(join(packs, name), 'utf8');
    }
    super({ ...options, store: new Store(path), bundle: { manifest, packs: definitions } });
    this.packs = packs;
  }
}
