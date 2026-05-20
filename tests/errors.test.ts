import { describe, it, expect } from 'vitest';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError, ValidationError, RateLimitError } from '../src/lib/errors';

describe('error classes', () => {
  it('AppError has correct properties', () => {
    const e = new AppError('test_code', 'Test message', 422, { extra: true });
    expect(e.code).toBe('test_code');
    expect(e.message).toBe('Test message');
    expect(e.statusCode).toBe(422);
    expect(e.details).toEqual({ extra: true });
    expect(e instanceof AppError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });

  it('NotFoundError defaults to 404', () => {
    const e = new NotFoundError('Session');
    expect(e.statusCode).toBe(404);
    expect(e.message).toContain('Session');
  });

  it('UnauthorizedError defaults to 401', () => {
    const e = new UnauthorizedError();
    expect(e.statusCode).toBe(401);
  });

  it('ForbiddenError defaults to 403', () => {
    const e = new ForbiddenError('No access');
    expect(e.statusCode).toBe(403);
    expect(e.message).toBe('No access');
  });

  it('ValidationError defaults to 400', () => {
    const e = new ValidationError('Bad input');
    expect(e.statusCode).toBe(400);
  });

  it('RateLimitError defaults to 429', () => {
    const e = new RateLimitError('Too many requests');
    expect(e.statusCode).toBe(429);
  });
});
