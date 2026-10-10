import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseMany, format } from '../src/ncon.mjs';
import { Project } from '../src/project.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let expressions = 0;
for (const directory of ['packs', 'examples']) for (const file of readdirSync(join(root, directory)).filter(f => f.endsWith('.ncon'))) {
  const terms = parseMany(readFileSync(join(root, directory, file), 'utf8'));
  for (const expression of terms) if (format(parseMany(format(expression))[0]) !== format(expression)) throw new Error('Roundtrip failed: ' + file);
  expressions += terms.length;
}
const project = new Project({ online: false }); project.close();
console.log(`Validated ${expressions} concept declarations and required boot behavior.`);
