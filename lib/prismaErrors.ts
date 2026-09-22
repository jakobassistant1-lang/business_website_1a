// Duck-typed Prisma error checks (no import of the Prisma error classes, so
// callers stay unit-testable with a mocked "@/lib/prisma").

/**
 * True when `err` is Prisma's unique-constraint violation (P2002). With
 * `field`, the violated index reported in `meta.target` must include that
 * column — a P2002 that names no target is NOT assumed to be that field.
 */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  if (!field) return true;
  const target = e.meta?.target;
  if (Array.isArray(target)) return target.includes(field);
  if (typeof target === "string") return target.includes(field);
  return false;
}
