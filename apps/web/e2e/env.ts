/** Origin of the web app under test. Default is the dev server on 3100; E2E_WEB_PORT selects another (e.g. an isolated production build). */
export const WEB_ORIGIN = `http://localhost:${process.env.E2E_WEB_PORT ?? '3100'}`;
