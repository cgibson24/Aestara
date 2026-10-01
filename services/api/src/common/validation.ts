// Request validation against the contract schemas → 400 VALIDATION_FAILED
// with field errors (spec §6.1.5). Messages describe the rule, never echo the
// submitted value.
import type { z } from "zod";
import { ApiError } from "./errors.ts";

function issueCode(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys") return "UNKNOWN_FIELD";
  if (issue.code === "custom") return "INVALID";
  return issue.code.toUpperCase();
}

export function validationError(error: z.ZodError, prefix?: string): ApiError {
  const fieldErrors = error.issues.slice(0, 50).flatMap((issue) => {
    const base = [prefix, ...issue.path.map(String)].filter(Boolean).join(".") || (prefix ?? "body");
    if (issue.code === "unrecognized_keys")
      return issue.keys.map((key) => ({
        path: base === "body" ? key : `${base}.${key}`,
        code: "UNKNOWN_FIELD",
        message: "This field is not allowed.",
      }));
    return [{ path: base, code: issueCode(issue), message: issue.message }];
  });
  // One error per field: the first rule it breaks.
  const seen = new Set<string>();
  const unique = fieldErrors.filter((e) => !seen.has(e.path) && seen.add(e.path));
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: unique });
}

export function parseInput<T extends z.ZodType>(schema: T, value: unknown, prefix?: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error, prefix);
  return result.data;
}
