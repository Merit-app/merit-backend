import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodObject } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      // If it's a ZodObject, validate against { body, query, params } selectively
      if (schema instanceof ZodObject) {
        const shape = schema.shape as Record<string, any>;
        const toValidate: Record<string, any> = {};
        if (shape.body) toValidate.body = req.body;
        if (shape.query) toValidate.query = req.query;
        if (shape.params) toValidate.params = req.params;
        const result = schema.parse(toValidate);
        if (shape.body) req.body = result.body;
        if (shape.query) (req as any).query = result.query;
        if (shape.params) (req as any).params = result.params;
      } else {
        // Plain schema validates req.body
        req.body = schema.parse(req.body);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
