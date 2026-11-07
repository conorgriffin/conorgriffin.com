import { getContext } from "../_lib/context.js";
import { licenseForSession } from "../_lib/handlers.js";

export async function GET(request) {
  return licenseForSession(getContext, request);
}
