import { redirectTo } from "../_lib/handlers.js";

export async function GET() {
  return redirectTo(() => process.env, "TESSERA_PAYMENT_LINK_URL");
}
