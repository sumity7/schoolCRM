// A tiny "evil site" on a DIFFERENT origin (port 3200) used by the CSRF E2E test.
// It tries to make the victim's browser send state-changing requests to the real app, with the victim's cookies.
import { createServer } from 'node:http';

const TARGET = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3100';

const page = `<!doctype html><meta charset="utf-8"><title>evil</title>
<body>
<script>
  window.results = {};
  // 1) "simple" cross-origin request (text/plain avoids a CORS preflight) carrying the victim's cookie
  fetch('${TARGET}/api/v1/auth/logout', { method: 'POST', credentials: 'include', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
    .then(() => { window.results.simple = 'sent'; }).catch((e) => { window.results.simple = 'blocked: ' + e.message; });
  // 2) request with the custom header (forces a preflight, which the API must not allow)
  fetch('${TARGET}/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'edunex', 'Content-Type': 'application/json' }, body: '{}' })
    .then(() => { window.results.custom = 'sent'; }).catch((e) => { window.results.custom = 'blocked: ' + e.message; });
</script>
<form id="f" method="POST" action="${TARGET}/api/v1/auth/logout" enctype="text/plain"><input name="x" value="y"></form>
<p>evil page</p>
</body>`;

createServer((req, res) => {
  if (req.url === '/form') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><body><form id="f" method="POST" action="${TARGET}/api/v1/auth/logout" enctype="text/plain"><input name="x" value="y"></form><script>document.getElementById('f').submit()</script></body>`);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(page);
}).listen(3200, () => console.log('attacker origin on 3200'));
