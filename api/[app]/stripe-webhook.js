import { appRoute } from "../_lib/route.js";
import { stripeWebhook } from "../_lib/handlers.js";

export const POST = appRoute(stripeWebhook);
