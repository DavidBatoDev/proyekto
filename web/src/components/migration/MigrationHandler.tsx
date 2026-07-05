import { useEffect, useState } from "react";
import { useUser, useProfile } from "@/stores/authStore";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import {
  migrationService,
  type MigrationStatus,
} from "@/services/migration.service";
import { MigrationModal } from "./MigrationModal";

/**
 * MigrationHandler - Automatically detects and migrates guest roadmaps in background
 * Place this component near the root of your app (in __root.tsx or App.tsx)
 */
export function MigrationHandler() {
  const user = useUser();
  const profile = useProfile();
  const { data: profileData, isLoading: isProfileLoading } = useProfileQuery();

  const [migrationStatus, setMigrationStatus] =
    useState<MigrationStatus | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  // Automatically migrate guest roadmaps in background when user authenticates
  useEffect(() => {
    const checkAndMigrate = async () => {
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
          setIsMigrating(true);
          setIsModalOpen(true);

          // Migrate automatically in background
          await migrationService.migrateRoadmaps();

          setIsMigrating(false);
        }
      } catch (error) {
        console.error("Migration failed:", error);
        setIsMigrating(false);
      }
    };

    checkAndMigrate();
  }, [user, profile, profileData, isProfileLoading]);

  const handleClose = () => {
    setIsModalOpen(false);
  };

  if (!migrationStatus?.roadmaps.length) {
    return null;
  }

  return (
    <MigrationModal
      isOpen={isModalOpen}
      roadmaps={migrationStatus.roadmaps}
      isMigrating={isMigrating}
      onClose={handleClose}
    />
  );
}
