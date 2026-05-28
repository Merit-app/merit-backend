export class AppError extends Error {
  constructor(
    public code: string,
    public override message: string,
    public statusCode = 400,
    public details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('not_found', `${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(msg = 'Authentication required') {
    super('unauthorized', msg, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(msg = 'Forbidden') {
    super('forbidden', msg, 403);
  }
}

export class ValidationError extends AppError {
  constructor(details: any) {
    super('validation_failed', 'Input validation failed', 400, details);
  }
}

export class RateLimitError extends AppError {
  constructor(details?: any) {
    super('rate_limit_exceeded', 'Too many requests', 429, details);
  }
}
