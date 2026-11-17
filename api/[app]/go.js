// /tessera/buy, /tessera/download (and the same under /switchboard), rewritten here with ?to=…&app=…: counts the click,
// then 302s to a URL held in an environment variable. One function for both keeps the deployment within the Hobby
// plan's 12-function limit.
import { appRoute } from "../_lib/route.js";
import { goHandler } from "../_lib/handlers.js";

export const GET = appRoute(goHandler);
