import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async handler so Express 5 forwards rejections to the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function laterIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
