export interface PaginationParams {
  page: number;
  perPage: number;
}

export function parsePagination(query: { page?: unknown; perPage?: unknown }, maxPerPage = 200): PaginationParams {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, parseInt(String(query.perPage ?? '20'), 10) || 20));
  return { page, perPage };
}

export function toRange(pagination: PaginationParams): { from: number; to: number } {
  const from = (pagination.page - 1) * pagination.perPage;
  const to = from + pagination.perPage - 1;
  return { from, to };
}
