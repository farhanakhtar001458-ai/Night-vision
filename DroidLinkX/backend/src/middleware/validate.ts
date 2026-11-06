import type { Request } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../utils/errors.js';

export function parse<S extends ZodTypeAny>(schema: S, value: unknown, label = 'body'): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Invalid ${label}`,
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const body = <S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> => parse(schema, req.body, 'body');

export const querySchema = <S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> =>
  parse(schema, req.query, 'query');

export const paramsSchema = <S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> =>
  parse(schema, req.params, 'path parameters');
