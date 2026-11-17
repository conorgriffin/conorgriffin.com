// Daily cron: /api/all/reconcile reconciles every configured app; /api/<app>/reconcile reconciles one.
import { appRoute } from "../_lib/route.js";
import { reconcileHandler } from "../_lib/handlers.js";

export const GET = appRoute(reconcileHandler, { allApps: true });
