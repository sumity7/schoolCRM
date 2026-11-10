// Fails if a production build (apps/web/.next) contains anything from the development-only demo login feature.
// Run after `npm run build`:  npm run check:bundle --workspace @edunex/web
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), process.env.NEXT_DIST_DIR || '.next');
const FORBIDDEN = ['Correct-Horse-9', 'owner@demo.test', 'tina@demo.test', 'accountant@demo.test', 'parent@demo.test', 'root@demo.test', '@demo.student', 'Try EduNex ERP Demo', 'Demo account not configured', '/auth/demo-accounts'];
const EXT = /\.(js|html|json|rsc|txt|map)$/;
const hits = [];
let scanned = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'cache') continue; // webpack build cache is not shipped
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.test(name)) {
      scanned++;
      const text = readFileSync(p, 'utf8');
      for (const f of FORBIDDEN) if (text.includes(f)) hits.push(`${p.slice(root.length + 1)}  contains  ${f}`);
    }
  }
})(root);
if (scanned === 0) { console.error('check-bundle: no build output found — run the production build first'); process.exit(2); }
if (hits.length) { console.error(`check-bundle: FAIL — demo-login material found in the production build:\n${hits.join('\n')}`); process.exit(1); }
console.log(`check-bundle: OK — ${scanned} files scanned, no demo credentials or demo-login code in the production build`);
