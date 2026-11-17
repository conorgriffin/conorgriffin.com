import { appRoute } from "../_lib/route.js";
import { licenseForSession } from "../_lib/handlers.js";

export const GET = appRoute(licenseForSession);
