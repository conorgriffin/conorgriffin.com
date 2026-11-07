import { getContext } from "../_lib/context.js";
import { revocations } from "../_lib/handlers.js";

export async function GET() {
  return revocations(getContext);
}
