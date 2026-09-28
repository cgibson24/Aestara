// The single Zod instance for this package, extended once with `.openapi()`
// so schemas can be registered as named OpenAPI components. Every schema file
// imports `z` from here, never from "zod" directly.
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export { z };
