import { createHash } from 'node:crypto';
import { format } from './ncon.mjs';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : format(value)).digest('hex').slice(0, 24);
