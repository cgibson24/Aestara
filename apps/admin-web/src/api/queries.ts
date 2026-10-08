// Server state through TanStack Query (spec §2.2 D-03; ADR-0003). Reads are
// queries keyed by resource; writes invalidate what they change. The cache is
// cleared whenever the session or the organization changes, so one tenant's
// data is never shown under another.
import { infiniteQueryOptions, QueryClient, queryOptions } from "@tanstack/react-query";
import { ApiError, api, type Schemas, unwrap } from "./client.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Retry only what may pass on a second try; a 4xx is the server's answer.
      retry: (failures, error) => failures < 2 && !(error instanceof ApiError && error.status < 500),
    },
  },
});

export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: async () => unwrap(await api.GET("/users", { params: { query: { limit: 100 } } })).data,
});

export const rolesQuery = queryOptions({
  queryKey: ["roles"],
  queryFn: async () => unwrap(await api.GET("/roles", { params: { query: { limit: 100 } } })).data,
  staleTime: 5 * 60_000,
});

export const sessionsQuery = queryOptions({
  queryKey: ["auth", "sessions"],
  queryFn: async () => unwrap(await api.GET("/auth/sessions", { params: { query: { limit: 50 } } })).data,
});

export interface AuditFilters {
  action?: Schemas["AuditAction"] | undefined;
  actorUserId?: string | undefined;
  patientId?: string | undefined;
  /** ISO 8601 instants. */
  from?: string | undefined;
  to?: string | undefined;
}

export const auditQuery = (filters: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: ["audit", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET("/audit/events", {
          params: {
            query: {
              limit: 50,
              ...(pageParam ? { cursor: pageParam } : {}),
              ...(filters.action ? { action: filters.action } : {}),
              ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
              ...(filters.patientId ? { patientId: filters.patientId } : {}),
              ...(filters.from ? { from: filters.from } : {}),
              ...(filters.to ? { to: filters.to } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => (last.page.hasMore ? last.page.nextCursor : undefined),
  });

export const practicesQuery = queryOptions({
  queryKey: ["practices"],
  queryFn: async () => unwrap(await api.GET("/practices", { params: { query: { limit: 100 } } })).data,
  staleTime: 5 * 60_000,
});

export const protocolsQuery = (status: Schemas["ProtocolStatus"] | undefined) =>
  queryOptions({
    queryKey: ["protocols", status ?? "ALL"],
    queryFn: async () =>
      unwrap(
        await api.GET("/photography-protocols", {
          params: { query: { limit: 100, ...(status ? { status } : {}) } },
        }),
      ).data,
  });

export const flagsQuery = (practiceId: string | undefined) =>
  queryOptions({
    queryKey: ["feature-flags", practiceId ?? "ORGANIZATION"],
    queryFn: async () =>
      unwrap(await api.GET("/feature-flags", { params: { query: practiceId ? { practiceId } : {} } })).data,
  });

export const offlinePolicyQuery = (practiceId: string) =>
  queryOptions({
    queryKey: ["settings", practiceId, "offline.cachePolicy"],
    queryFn: async () =>
      unwrap(
        await api.GET("/settings/practices/{practiceId}/{key}", {
          params: { path: { practiceId, key: "offline.cachePolicy" } },
        }),
      ).data,
  });

export const retentionQuery = queryOptions({
  queryKey: ["retention-policies"],
  queryFn: async () =>
    unwrap(await api.GET("/retention-policies", { params: { query: { limit: 100 } } })).data,
});

/** Every page of a catalog collection: an organization's catalog is small, but never cut off at one page. */
async function allPages<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ data: T[]; page: { hasMore: boolean; nextCursor?: string } }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const res = await fetchPage(cursor);
    items.push(...res.data);
    if (!res.page.hasMore || res.page.nextCursor === undefined) return items;
    cursor = res.page.nextCursor;
  }
  return items;
}

export const treatmentCategoriesQuery = queryOptions({
  queryKey: ["treatment-categories"],
  queryFn: () =>
    allPages(async (cursor) =>
      unwrap(
        await api.GET("/treatment-categories", {
          params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } },
        }),
      ),
    ),
});

export const treatmentsQuery = queryOptions({
  queryKey: ["treatments"],
  queryFn: () =>
    allPages(async (cursor) =>
      unwrap(
        await api.GET("/treatments", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } }),
      ),
    ),
});
