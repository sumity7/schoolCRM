# Local setup (zero cost)

Prerequisites: Node.js 22+, npm 10+, Git. A MongoDB server binary is needed only for tests/dev DB: either let `mongodb-memory-server`
download one on first run (~590 MB, cached), or point at an installed `mongod` (see below).

```
npm install                     # installs all workspaces
cp .env.example apps/api/.env   # PowerShell: Copy-Item .env.example apps/api/.env
```

## Run the app locally
```
# terminal 1 — persistent local MongoDB replica set (data in apps/api/.data/mongo, git-ignored)
npm run dev:db
# terminal 2 — API on :4000
npm run dev:api
# terminal 3 — web on :3000 (proxies /api/* to the API: ADR-2)
npm run dev:web
```
Create the first platform admin and a school (R1 has no web Super-Admin console; provisioning is CLI-only):
```
npm run cli --workspace @edunex/api -- create-super-admin --email you@example.test --name "You"
npm run cli --workspace @edunex/api -- create-school --code demo --name "Demo School (synthetic)" --owner-email owner@demo.test --owner-name "Owner"
```
The owner invitation link is printed and also written to `apps/api/.data/mail/` (dev outbox — no real email is sent).
Use **synthetic data only**; never load real student data into a development machine.

### Notes
- `npm run seed:demo` creates a synthetic school: `owner@demo.test` / `tina@demo.test`, password `Correct-Horse-9`.
- Set `DEV_DB_PATH` to put the dev database somewhere else (e.g. if `apps/api/.data/mongo` was left broken by an interrupted first start).
- Set `MONGOMS_SYSTEM_BINARY` to reuse an installed `mongod` instead of downloading one.

## Tests
```
# optional (PowerShell): reuse an installed mongod instead of downloading one
$env:MONGOMS_SYSTEM_BINARY="C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"; $env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK="false"
npm run typecheck ; npm run lint ; npm run test            # API: 118 tests
cd apps/web ; $env:PW_CHANNEL="msedge" ; npx playwright test   # browser E2E (or install Playwright's Chromium and omit PW_CHANNEL)
```
