import { describe, it, expect } from 'vitest';
import { success, paginated } from '../src/utils/shape';
import { formatDate, formatHours, formatCurrency, capitalize } from '../src/utils/format';

describe('shape utils', () => {
  it('success wraps data', () => {
    expect(success({ foo: 1 })).toEqual({ data: { foo: 1 } });
  });

  it('paginated includes hasMore=true when more records exist', () => {
    const result = paginated([1, 2, 3], { total: 10, page: 1, perPage: 3 });
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.total).toBe(10);
  });

  it('paginated includes hasMore=false on last page', () => {
    const result = paginated([1, 2], { total: 2, page: 1, perPage: 10 });
    expect(result.meta.hasMore).toBe(false);
  });
});

describe('format utils', () => {
  it('formatDate returns localized string', () => {
    const s = formatDate('2024-06-15');
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });

  it('formatHours formats plural correctly', () => {
    expect(formatHours(3)).toBe('3 hours');
    expect(formatHours(1)).toBe('1 hour');
    expect(formatHours(2)).toBe('2 hours');
  });

  it('formatCurrency formats USD cents', () => {
    // formatCurrency receives cents: 1234 cents = $12.34
    const s = formatCurrency(1234);
    expect(s).toContain('$');
    expect(s).toContain('12');
  });

  it('capitalize uppercases first letter', () => {
    expect(capitalize('hello world')).toBe('Hello world');
    expect(capitalize('')).toBe('');
  });
});
