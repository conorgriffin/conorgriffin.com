import { appRoute } from "../_lib/route.js";
import { resend } from "../_lib/handlers.js";

export const POST = appRoute(resend);
