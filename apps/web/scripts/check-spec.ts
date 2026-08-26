import { parseStyleSpec } from '@seamsterly/stylespec';
import { readFileSync } from 'node:fs';
try {
  parseStyleSpec(JSON.parse(readFileSync(process.argv[2]!, 'utf8')));
  console.log('ok');
} catch (e) {
  const err = e as { details?: unknown };
  console.log(String(err.details ? JSON.stringify(err.details) : e).slice(0, 800));
}
