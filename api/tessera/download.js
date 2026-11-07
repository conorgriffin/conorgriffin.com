import { redirectTo, salesOpen } from "../_lib/handlers.js";

export async function GET() {
  if (!salesOpen(process.env)) return new Response("Not found", { status: 404 });
  return redirectTo(() => process.env, "TESSERA_DOWNLOAD_URL");
}
