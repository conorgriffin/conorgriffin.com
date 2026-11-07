import { getContext } from "../_lib/context.js";
import { stripeWebhook } from "../_lib/handlers.js";

export async function POST(request) {
  return stripeWebhook(getContext, request);
}
