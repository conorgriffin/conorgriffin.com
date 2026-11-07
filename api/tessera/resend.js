import { getContext } from "../_lib/context.js";
import { resend } from "../_lib/handlers.js";

export async function POST(request) {
  return resend(getContext, request);
}
