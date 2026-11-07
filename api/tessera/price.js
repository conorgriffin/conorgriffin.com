import { getContext } from "../_lib/context.js";
import { tesseraPrice } from "../_lib/handlers.js";

export async function GET(/** @type {Request} */ request) {
  return tesseraPrice(getContext, request);
}
