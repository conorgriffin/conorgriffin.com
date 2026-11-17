import { appRoute } from "../_lib/route.js";
import { revocations } from "../_lib/handlers.js";

export const GET = appRoute(revocations);
