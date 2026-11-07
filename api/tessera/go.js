// /tessera/buy and /tessera/download (rewritten here with ?to=…): 302 to a URL held in an environment variable.
// One function for both keeps the deployment within the Hobby plan's 12-function limit.
import { redirectTo, salesOpen } from "../_lib/handlers.js";

const targets = /** @type {Record<string, string>} */ ({ buy: "TESSERA_PAYMENT_LINK_URL", download: "TESSERA_DOWNLOAD_URL" });

export async function GET(/** @type {Request} */ request) {
  const name = targets[new URL(request.url).searchParams.get("to") ?? ""];
  if (!name || !salesOpen(process.env)) return new Response("Not found", { status: 404 });
  return redirectTo(() => process.env, name);
}
