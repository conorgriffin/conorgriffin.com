// Shared by every file in api/[app]/: picks the app for the request and hands the handler that app's context.
// One function per route serves every app in apps.js (Vercel Hobby: 12 functions), so /api/tessera/x and
// /api/switchboard/x are the same function with a different app.
import { appFromRequest } from "./apps.js";
import { getContext } from "./context.js";

const ALL_RECONCILE_PATH = /^\/api\/all\/reconcile\/?$/;

const notFound = () => Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Wraps a handler `(getCtx, request) => Response`. An unknown app slug answers 404 before anything else runs.
 * `allApps: true` (the reconcile route only) also accepts /api/all/reconcile, the daily cron's path.
 * @param {(getCtx: (slug: string) => any, request: Request) => Response | Promise<Response>} handler
 * @param {{ allApps?: boolean }} [opts]
 */
export function appRoute(handler, { allApps = false } = {}) {
  return (/** @type {Request} */ request) => {
    if (!appFromRequest(request) && !(allApps && ALL_RECONCILE_PATH.test(new URL(request.url).pathname))) return notFound();
    return handler(getContext, request);
  };
}

/** Every HTTP method goes to the handler, so an unconfigured route answers 404 whatever the verb. @param {(getCtx: (slug: string) => any, request: Request) => Response | Promise<Response>} handler */
export function allMethods(handler) {
  const handle = appRoute(handler);
  return { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle };
}
