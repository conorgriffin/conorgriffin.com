import { allMethods } from "../_lib/route.js";
import { adminSession } from "../_lib/handlers.js";

// Every method goes to the handler so an unconfigured route answers 404 whatever the verb.
const methods = allMethods(adminSession);

export const GET = methods.GET;
export const POST = methods.POST;
export const PUT = methods.PUT;
export const PATCH = methods.PATCH;
export const DELETE = methods.DELETE;
