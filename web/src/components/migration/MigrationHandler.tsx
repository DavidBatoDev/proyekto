import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useUser, useProfile } from "@/stores/authStore";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import {
  migrationService,
  type MigrationStatus,
} from "@/services/migration.service";
import { MigrationModal } from "./MigrationModal";
import { clearGuestSession } from "@/lib/guestAuth";
import {
	clearGuestRoadmapMetadata,
	getGuestRoadmapMetadata,
	hasPendingProjectFromRoadmapIntent,
	setPendingProjectFromRoadmap,
} from "@/lib/guestRoadmapConversion";
import type { Roadmap } from "@/types/roadmap";

/**
 * MigrationHandler - Automatically detects and migrates guest roadmaps in background
 * Place this component near the root of your app (in __root.tsx or App.tsx)
 */
export function MigrationHandler() {
  const navigate = useNavigate();
  const user = useUser();
  const profile = useProfile();
  const { data: profileData, isLoading: isProfileLoading } = useProfileQuery();

  const [migrationStatus, setMigrationStatus] =
    useState<MigrationStatus | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Detect recoverable guest roadmaps after auth. When a project conversion
  // intent is pending, stay silent so the transient conversion route can claim
  // the selected roadmap without the legacy migration racing it.
  useEffect(() => {
    const checkForRecovery = async () => {
      const activeProfile = profileData ?? profile;

      if (!user) {
        // User not authenticated, reset
        setMigrationStatus(null);
        setIsModalOpen(false);
        return;
      }

      if (isProfileLoading) {
        return;
      }

      // Wait for profile to be loaded and email to be verified
      if (!activeProfile || !activeProfile.is_email_verified) {
        return;
      }

      if (hasPendingProjectFromRoadmapIntent()) {
        setMigrationStatus(null);
        setIsModalOpen(false);
        return;
      }

      const cachedGuestRoadmap = getGuestRoadmapMetadata();
      if (cachedGuestRoadmap?.roadmapId) {
        const recoveredRoadmap: Roadmap = {
          id: cachedGuestRoadmap.roadmapId,
          project_id: null,
          name: cachedGuestRoadmap.title || "Untitled roadmap",
          owner_id: "",
          status: "draft",
          created_at: cachedGuestRoadmap.createdAt,
          updated_at: cachedGuestRoadmap.lastViewed,
        };
        setMigrationStatus({
          hasGuestRoadmaps: true,
          guestUserId: null,
          roadmaps: [recoveredRoadmap],
          isComplete: false,
          isSkipped: false,
        });
        setIsModalOpen(true);
        return;
      }

      // User is authenticated and verified, check for guest roadmaps
      try {
        const status = await migrationService.checkForGuestRoadmaps();

        // If there are guest roadmaps and migration not complete
        if (
          status.hasGuestRoadmaps &&
          status.guestUserId &&
          !status.isComplete &&
          !status.isSkipped
        ) {
          setMigrationStatus(status);
          setIsModalOpen(true);
        }
      } catch (error) {
        console.error("Guest roadmap recovery check failed:", error);
      }
    };

    checkForRecovery();
  }, [user, profile, profileData, isProfileLoading]);

  const handleCreateProject = () => {
    const roadmap = migrationStatus?.roadmaps[0];
    if (!roadmap) return;
    setPendingProjectFromRoadmap({
      roadmapId: roadmap.id,
      title: roadmap.name,
      source: "recovery_modal",
    });
    setIsModalOpen(false);
    navigate({
      to: "/project/roadmap/convert/$roadmapId",
      params: { roadmapId: roadmap.id },
    });
  };

  const handleDiscard = () => {
    migrationService.skipMigration();
    clearGuestRoadmapMetadata();
    clearGuestSession();
    setMigrationStatus(null);
    setIsModalOpen(false);
  };

  if (!migrationStatus?.roadmaps.length) {
    return null;
  }

  return (
    <MigrationModal
      isOpen={isModalOpen}
      roadmaps={migrationStatus.roadmaps}
      onCreateProject={handleCreateProject}
      onDiscard={handleDiscard}
    />
  );
}
