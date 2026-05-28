import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { captureException } from '../config/sentry';
import { logger } from '../lib/logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      captureException(err, { requestId: req.id, path: req.path });
      logger.error({ err, requestId: req.id }, err.message);
    } else {
      logger.warn({ err, requestId: req.id }, err.message);
    }
    return res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    logger.warn({ err, requestId: req.id }, 'Validation error');
    return res.status(400).json({
      error: 'validation_failed',
      message: 'Input validation failed',
      details: err.flatten().fieldErrors,
    });
  }

  // Unexpected error
  captureException(err, { requestId: req.id, path: req.path });
  logger.error({ err, requestId: req.id }, 'Unhandled error');
  return res.status(500).json({
    error: 'internal_error',
    message: 'An unexpected error occurred',
  });
}
