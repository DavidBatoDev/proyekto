import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy redirect: the permissions reference + per-member editor live at
// `/settings/permissions` now. Keep this redirect so any old bookmarks,
// emails, or in-flight nav don't 404.
export const Route = createFileRoute("/project/$projectId/settings/team")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/project/$projectId/settings/permissions",
      params: { projectId: params.projectId },
    });
  },
});
