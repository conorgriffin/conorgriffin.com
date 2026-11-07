import { getContext } from "../_lib/context.js";
import { reconcileHandler } from "../_lib/handlers.js";

export async function GET(request) {
  return reconcileHandler(getContext, request);
}
