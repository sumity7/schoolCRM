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

### Platform console
After `create-super-admin`, sign in at `/login`: you land on `/platform`, which first asks you to turn on two-factor authentication (enter the shown key in an authenticator app). From then on every sign-in asks for the 6-digit code. Schools can then be created from the console instead of the CLI.

### Notes
- `npm run seed:demo` creates (or tops up — it is idempotent and only adds) a synthetic school and its demo logins, all with password `Correct-Horse-9`: `owner@demo.test` (School Admin), `tina@demo.test` (Teacher), `accountant@demo.test`, `parent@demo.test`, `demo-a1@demo.student` (Student), `root@demo.test` (Super Admin — enrol an authenticator app on first sign-in). It refuses to run in production/staging and never deletes data.
- Set `DEV_DB_PATH` to put the dev database somewhere else (e.g. if `apps/api/.data/mongo` was left broken by an interrupted first start).
- Set `MONGOMS_SYSTEM_BINARY` to reuse an installed `mongod` instead of downloading one.

### Login-page demo accounts (development only)
With `NODE_ENV=development` the login page shows "Try EduNex ERP Demo": six role cards. Clicking a card only **fills** the form (it never signs you in); press **Sign in** as usual and you land on the dashboard of the real server-side role. Cards for accounts that do not exist show "Demo account not configured yet." — run `npm run seed:demo` to create them.
- Controlled by the server flag `DEMO_LOGIN_ENABLED` (default: on only in development). The API refuses to start with it on in production/staging, the `/auth/demo-accounts` route does not exist when it is off, and demo credentials are never part of the web bundle.
- After a production build, `npm run check:bundle --workspace @edunex/web` fails if any demo credential or demo-login code is found in the output.
- Do not run a production `next build` while a dev server is using `apps/web/.next`.

## Tests
```
# optional (PowerShell): reuse an installed mongod instead of downloading one
$env:MONGOMS_SYSTEM_BINARY="C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"; $env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK="false"
npm run typecheck ; npm run lint ; npm run test            # API: 118 tests
cd apps/web ; $env:PW_CHANNEL="msedge" ; npx playwright test   # browser E2E (or install Playwright's Chromium and omit PW_CHANNEL)
```
