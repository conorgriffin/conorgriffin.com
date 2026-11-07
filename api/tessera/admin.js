import { getContext } from "../_lib/context.js";
import { adminHandler } from "../_lib/handlers.js";

// Every method goes to the handler so an unconfigured route answers 404 whatever the verb.
const handle = (request) => adminHandler(getContext, request);

export const POST = handle;
export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
