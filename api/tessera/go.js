// /tessera/buy and /tessera/download (rewritten here with ?to=…): counts the click, then 302s to a URL held in an
// environment variable. One function for both keeps the deployment within the Hobby plan's 12-function limit.
import { getContext } from "../_lib/context.js";
import { goHandler } from "../_lib/handlers.js";

export const GET = (/** @type {Request} */ request) => goHandler(getContext, request);
