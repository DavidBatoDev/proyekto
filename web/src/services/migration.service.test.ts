import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedPost, mockedGet } = vi.hoisted(() => ({
  mockedPost: vi.fn(),
  mockedGet: vi.fn(),
}));

const { mockedGetGuestSessionId, mockedGetCachedGuestUserId, mockedClearGuestSession } =
  vi.hoisted(() => ({
    mockedGetGuestSessionId: vi.fn(),
    mockedGetCachedGuestUserId: vi.fn(),
    mockedClearGuestSession: vi.fn(),
  }));

vi.mock("@/api", () => ({
  apiClient: {
    post: mockedPost,
    get: mockedGet,
  },
}));

vi.mock("@/lib/guestAuth", () => ({
  getGuestSessionId: mockedGetGuestSessionId,
  getCachedGuestUserId: mockedGetCachedGuestUserId,
  clearGuestSession: mockedClearGuestSession,
}));

const { mockedGetAccessToken } = vi.hoisted(() => ({
  mockedGetAccessToken: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getAccessToken: mockedGetAccessToken,
}));

import {
  migrationService,
  runGuestMigrationIfNeeded,
} from "./migration.service";

describe("migrationService.migrateRoadmaps contract", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedGet.mockReset();
    mockedGetGuestSessionId.mockReset();
    mockedGetCachedGuestUserId.mockReset();
    mockedClearGuestSession.mockReset();
  });

  it("posts { session_id } and maps the { data: { migrated } } envelope", async () => {
    mockedGetGuestSessionId.mockReturnValue("guest_abc-123");
    mockedPost.mockResolvedValue({ data: { data: { migrated: 3 } } });

    const result = await migrationService.migrateRoadmaps();

    expect(mockedPost).toHaveBeenCalledWith("/api/roadmaps/migrate", {
      session_id: "guest_abc-123",
    });
    expect(result).toEqual({ success: true, migratedCount: 3 });
  });

  it("clears the guest session on success", async () => {
    mockedGetGuestSessionId.mockReturnValue("guest_abc-123");
    mockedPost.mockResolvedValue({ data: { data: { migrated: 1 } } });

    await migrationService.migrateRoadmaps();

    expect(mockedClearGuestSession).toHaveBeenCalledTimes(1);
  });

  it("does not clear the guest session when the request fails", async () => {
    mockedGetGuestSessionId.mockReturnValue("guest_abc-123");
    mockedPost.mockRejectedValue(new Error("boom"));

    await expect(migrationService.migrateRoadmaps()).rejects.toThrow();
    expect(mockedClearGuestSession).not.toHaveBeenCalled();
  });
});

describe("runGuestMigrationIfNeeded", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedGetGuestSessionId.mockReset();
    mockedClearGuestSession.mockReset();
    mockedGetAccessToken.mockReset();
    mockedGetAccessToken.mockResolvedValue("jwt-token");
  });

  it("returns 0 without calling the API when there is no guest session", async () => {
    mockedGetGuestSessionId.mockReturnValue(null);

    const migrated = await runGuestMigrationIfNeeded();

    expect(migrated).toBe(0);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("returns 0 without calling the API when there is no access token (would authenticate as the guest)", async () => {
    mockedGetGuestSessionId.mockReturnValue("guest_abc-123");
    mockedGetAccessToken.mockResolvedValue(null);

    const migrated = await runGuestMigrationIfNeeded();

    expect(migrated).toBe(0);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedClearGuestSession).not.toHaveBeenCalled();
  });

  it("returns the migrated count when a guest session exists", async () => {
    mockedGetGuestSessionId.mockReturnValue("guest_abc-123");
    mockedPost.mockResolvedValue({ data: { data: { migrated: 2 } } });

    const migrated = await runGuestMigrationIfNeeded();

    expect(migrated).toBe(2);
    expect(mockedPost).toHaveBeenCalledWith("/api/roadmaps/migrate", {
      session_id: "guest_abc-123",
    });
  });

  it("is best-effort: returns 0 instead of throwing when migration fails", async () => {
    mockedGetGuestSessionId.mockReturnValue("guest_abc-123");
    mockedPost.mockRejectedValue(new Error("network down"));

    await expect(runGuestMigrationIfNeeded()).resolves.toBe(0);
  });
});
