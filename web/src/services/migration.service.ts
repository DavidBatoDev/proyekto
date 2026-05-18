/**
 * Migration Service
 * Handles guest roadmap migration to authenticated users
 */

import { apiClient } from "@/api";
import { getCachedGuestUserId, clearGuestSession } from "@/lib/guestAuth";
import type { Roadmap } from "@/types/roadmap";

export interface MigrationStatus {
  hasGuestRoadmaps: boolean;
  guestUserId: string | null;
  roadmaps: Roadmap[];
  isComplete: boolean;
  isSkipped: boolean;
}

export class MigrationServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: unknown,
  ) {
    super(message);
    this.name = "MigrationServiceError";
  }
}

function handleError(error: unknown, operation: string): never {
  console.error(`[MigrationService] ${operation} failed:`, error);

  if (error instanceof Error) {
    const axiosError = error as any;
    if (axiosError.response) {
      const status = axiosError.response.status;
      const message =
        axiosError.response.data?.error ||
        axiosError.response.data?.message ||
        error.message;
      throw new MigrationServiceError(message, status, error);
    }
    throw new MigrationServiceError(error.message, undefined, error);
  }

  throw new MigrationServiceError(
    "An unexpected error occurred during migration",
    undefined,
    error,
  );
}

class MigrationService {
  private readonly MIGRATION_STATUS_KEY = "proyekto_migration_status";
  private readonly LEGACY_MIGRATION_STATUS_KEY = "prdigy_migration_status";

  /**
   * Check if there are guest roadmaps to migrate
   */
  async checkForGuestRoadmaps(): Promise<MigrationStatus> {
    const guestUserId = getCachedGuestUserId();

    if (!guestUserId) {
      return {
        hasGuestRoadmaps: false,
        guestUserId: null,
        roadmaps: [],
        isComplete: true,
        isSkipped: false,
      };
    }

    try {
      const response = await apiClient.get<{ roadmaps: Roadmap[] }>(
        `/api/roadmaps/user/${guestUserId}`,
      );

      const roadmaps = response.data.roadmaps || [];
      const migrationStatus = this.getMigrationStatus();

      return {
        hasGuestRoadmaps: roadmaps.length > 0,
        guestUserId,
        roadmaps,
        isComplete: migrationStatus?.isComplete || false,
        isSkipped: migrationStatus?.isSkipped || false,
      };
    } catch (error) {
      handleError(error, "checkForGuestRoadmaps");
    }
  }

  /**
   * Migrate guest roadmaps to authenticated user
   */
  async migrateRoadmaps(
    guestUserId: string,
    targetUserId: string,
  ): Promise<{ success: boolean; migratedCount: number }> {
    try {
      const response = await apiClient.post<{
        success: boolean;
        migratedCount: number;
      }>("/api/roadmaps/migrate", {
        guestUserId,
        targetUserId,
      });

      if (response.data.success) {
        // Mark migration as complete
        this.setMigrationStatus({
          isComplete: true,
          isSkipped: false,
          migratedCount: response.data.migratedCount,
          completedAt: new Date().toISOString(),
        });

        // Clear guest session data
        clearGuestSession();
      }

      return response.data;
    } catch (error) {
      handleError(error, "migrateRoadmaps");
    }
  }

  /**
   * Skip migration (user chooses to organize later)
   */
  skipMigration(): void {
    this.setMigrationStatus({
      isComplete: false,
      isSkipped: true,
      skippedAt: new Date().toISOString(),
    });
  }

  /**
   * Reset migration status (for re-triggering migration)
   */
  resetMigrationStatus(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(this.MIGRATION_STATUS_KEY);
    localStorage.removeItem(this.LEGACY_MIGRATION_STATUS_KEY);
  }

  /**
   * Get stored migration status
   */
  private getMigrationStatus(): any {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(this.MIGRATION_STATUS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }

    const legacyStored = localStorage.getItem(this.LEGACY_MIGRATION_STATUS_KEY);
    if (!legacyStored) {
      return null;
    }

    localStorage.setItem(this.MIGRATION_STATUS_KEY, legacyStored);
    localStorage.removeItem(this.LEGACY_MIGRATION_STATUS_KEY);
    return JSON.parse(legacyStored);
  }

  /**
   * Store migration status
   */
  private setMigrationStatus(status: any): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.MIGRATION_STATUS_KEY, JSON.stringify(status));
  }
}

export const migrationService = new MigrationService();
