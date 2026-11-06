import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Validates req.body against a Zod schema and replaces it with the parsed, stripped value. */
export const validateBody = (schema: ZodType): RequestHandler => (req, _res, next) => {
  req.body = schema.parse(req.body);
  next();
};
