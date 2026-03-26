export const OPEN_PROJECT_INVITE_MODAL_EVENT = "open-project-invite-modal";

export type OpenProjectInviteModalDetail = {
  inviteId?: string;
};

export function openProjectInviteModal(inviteId?: string) {
  if (typeof window === "undefined") return;

  const detail: OpenProjectInviteModalDetail = inviteId ? { inviteId } : {};
  window.dispatchEvent(
    new CustomEvent<OpenProjectInviteModalDetail>(
      OPEN_PROJECT_INVITE_MODAL_EVENT,
      { detail },
    ),
  );
}
