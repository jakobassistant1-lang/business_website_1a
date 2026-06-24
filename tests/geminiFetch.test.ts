import { describe, it, expect, vi, afterEach } from "vitest";
import { geminiPost, salvageJsonObjects } from "@/lib/geminiFetch";

const resp = (status: number) => new Response(status === 200 ? "{}" : "err", { status });
afterEach(() => vi.restoreAllMocks());

describe("geminiPost — transient-failure backoff", () => {
  it("retries a 503 then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const { res } = await geminiPost("u", {}, { timeoutMs: 100, backoffMs: 1 });
    expect(res?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(429)).mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const { res } = await geminiPost("u", {}, { timeoutMs: 100, backoffMs: 1 });
    expect(res?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after `attempts` on a persistent 503, returning the last response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(503));
    vi.stubGlobal("fetch", fetchMock);
    const { res } = await geminiPost("u", {}, { timeoutMs: 100, attempts: 3, backoffMs: 1 });
    expect(res?.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a non-retryable status (400)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(400));
    vi.stubGlobal("fetch", fetchMock);
    const { res } = await geminiPost("u", {}, { timeoutMs: 100, backoffMs: 1 });
    expect(res?.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient network error (non-abort throw) then succeeds", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const { res, timedOut } = await geminiPost("u", {}, { timeoutMs: 100, backoffMs: 1 });
    expect(res?.status).toBe(200);
    expect(timedOut).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a timeout (AbortError) without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, timedOut } = await geminiPost("u", {}, { timeoutMs: 100, backoffMs: 1 });
    expect(res).toBeNull();
    expect(timedOut).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("succeeds on the first try without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(200));
    vi.stubGlobal("fetch", fetchMock);
    const { res, timedOut } = await geminiPost("u", {}, { timeoutMs: 100, backoffMs: 1 });
    expect(res?.status).toBe(200);
    expect(timedOut).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("salvageJsonObjects — partial recovery from truncated/garbled JSON", () => {
  it("keeps the complete objects when the array is cut off mid-item", () => {
    const truncated = '[{"id":1,"x":"a"},{"id":2,"x":"b"},{"id":3,"x":"incompl';
    const out = salvageJsonObjects(truncated) as Array<{ id: number }>;
    expect(out.map((o) => o.id)).toEqual([1, 2]); // the cut-off 3rd is dropped, first two kept
  });
  it("ignores braces inside string values", () => {
    const out = salvageJsonObjects('[{"id":1,"note":"has {braces} and \\" quote"}]') as Array<{ note: string }>;
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe('has {braces} and " quote');
  });
  it("returns [] for text with no complete object", () => {
    expect(salvageJsonObjects("totally broken {")).toEqual([]);
  });
});
