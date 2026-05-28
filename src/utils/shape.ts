export function success<T>(data: T) {
  return { data };
}

export function paginated<T>(
  data: T[],
  meta: { total: number; page: number; perPage: number },
) {
  return {
    data,
    meta: { ...meta, hasMore: meta.page * meta.perPage < meta.total },
  };
}

export function noContent() {
  return {};
}
