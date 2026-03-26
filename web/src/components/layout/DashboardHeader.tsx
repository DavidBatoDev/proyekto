import { type MouseEvent, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Badge,
  Box,
  Divider,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../ui/button";
import Logo from "/prodigylogos/light/logovector.svg";
import { useAuthStore, useIsLoading } from "@/stores/authStore";
import UserMenu from "./UserMenu";
import { MessageCircle, Bell, Search, ChevronDown } from "lucide-react";
import { notificationsService } from "@/services/notifications.service";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { openProjectInviteModal } from "@/components/invites/projectInviteModalEvents";

const DashboardHeader = () => {
  const { isAuthenticated, profile } = useAuthStore();
  const isAuthLoading = useIsLoading();
  const isLoading = isAuthLoading || (isAuthenticated && !profile);
  const [consultantsMenuOpen, setConsultantsMenuOpen] = useState(false);
  const [notificationAnchor, setNotificationAnchor] =
    useState<HTMLElement | null>(null);
  const queryClient = useQueryClient();

  useNotificationsRealtime(profile?.id);

  const unreadCountQuery = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => notificationsService.unreadCount(),
    enabled: isAuthenticated,
  });

  const recentNotificationsQuery = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => notificationsService.list({ limit: 5 }),
    enabled: isAuthenticated,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id, true),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsService.markAllRead(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unreadCount = unreadCountQuery.data ?? 0;
  const recentNotifications = recentNotificationsQuery.data || [];

  const openNotifications = (event: MouseEvent<HTMLElement>) => {
    setNotificationAnchor(event.currentTarget);
  };

  const closeNotifications = () => {
    setNotificationAnchor(null);
  };

  const handleNotificationClick = (
    id: string,
    linkUrl?: string | null,
    typeName?: string,
    inviteId?: string | null,
  ) => {
    if (!id) return;
    closeNotifications();

    if (typeName === "project_invite_received" && inviteId) {
      openProjectInviteModal(inviteId);
      markReadMutation.mutate(id);
      return;
    }

    markReadMutation.mutate(id);

    if (linkUrl) {
      window.location.href = linkUrl;
    }
  };

  const navItems = [
    { label: "Home", href: "/dashboard" },
    { label: "Projects", href: "/" },
    {
      label: "Market place",
      href: profile?.is_consultant_verified
        ? "/consultant/marketplace"
        : "/consultant/browse",
    },
    ...(profile?.is_consultant_verified
      ? [{ label: "Templates", href: "/consultant/templates" }]
      : []),
  ];

  const getPersonaMenu = () => {
    const persona = profile?.active_persona || "client";
    const isConsultantVerified = profile?.is_consultant_verified;

    // Shared CTA — only shown when not yet a verified consultant
    const applyItem = !isConsultantVerified
      ? [
          {
            label: "Apply as Consultant",
            href: "/consultant/apply",
            divider: true,
          },
        ]
      : [];

    switch (persona) {
      case "freelancer":
        return {
          label: "Mentorship",
          items: [
            profile?.is_public
              ? { label: "You're Live", href: "/consultant/marketplace" }
              : {
                  label: "Get Hired (I Want to Work)",
                  href: "/freelancer/go-live",
                },
            { label: "My Invites", href: "/freelancer/invites" },
            { label: "Find a Mentor", href: "/mentors" },
            { label: "My Applications", href: "/applications" },
            { label: "Saved Mentors", href: "/saved-mentors" },
            ...applyItem,
          ],
        };
      case "consultant":
        return {
          label: "My Clients",
          items: [
            {
              label: "Private Freelancer Marketplace",
              href: "/consultant/marketplace",
            },
            {
              label: "Template Roadmaps",
              href: "/consultant/templates",
            },
            { label: "Browse Opportunities", href: "/projects" },
            { label: "My Clients", href: "/clients" },
            { label: "Active Contracts", href: "/contracts" },
          ],
        };
      case "client":
      default:
        return {
          label: "My Consultants",
          items: [
            { label: "Post a Project", href: "/project-posting" },
            {
              label: "Browse Professional Consultants",
              href: "/consultant/browse",
            },
            { label: "My Consultant Pool", href: "/consultant-pool" },
            { label: "Direct Contacts", href: "/direct-contacts" },
            ...applyItem,
          ],
        };
    }
  };

  const menuConfig = getPersonaMenu();

  return (
    <div className="w-full h-full flex items-center justify-between px-6 shrink-0 z-10">
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          gap: { xs: 2, md: 3 },
        }}
      >
        {/* Left Side: Logo + Navigation */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: { xs: 2, md: 3, lg: 4 },
          }}
        >
          {/* Logo */}
          <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <Link
              to="/"
              className="cursor-pointer flex items-center shrink-0 border-r border-gray-200 pr-4"
            >
              <img src={Logo} alt="Prodigy Logo" style={{ height: "24px" }} />
            </Link>
          </Box>

          {/* Navigation Items */}
          <Stack
            direction="row"
            spacing={{ xs: 1.5, md: 2, lg: 3 }}
            sx={{
              alignItems: "center",
            }}
          >
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.href}
                style={{ textDecoration: "none" }}
              >
                <Typography
                  component="span"
                  sx={{
                    color: "#2F302F",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontSize: { xs: "0.8rem", md: "0.85rem" },
                    fontWeight: 600,
                    "&:hover": {
                      color: "var(--primary)",
                    },
                  }}
                >
                  {item.label}
                </Typography>
              </Link>
            ))}

            {/* My Consultants Dropdown */}
            <Box
              sx={{ position: "relative" }}
              onMouseEnter={() => setConsultantsMenuOpen(true)}
              onMouseLeave={() => setConsultantsMenuOpen(false)}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  cursor: "pointer",
                }}
              >
                <Typography
                  component="span"
                  sx={{
                    color: "#2F302F",
                    whiteSpace: "nowrap",
                    fontSize: { xs: "0.8rem", md: "0.85rem" },
                    fontWeight: 600,
                    "&:hover": {
                      color: "var(--primary)",
                    },
                  }}
                >
                  {menuConfig.label}
                </Typography>
                <ChevronDown
                  size={16}
                  color="#2F302F"
                  style={{
                    transition: "transform 0.2s ease",
                    transform: consultantsMenuOpen
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                  }}
                />
              </Box>

              {/* Dropdown Menu */}
              {consultantsMenuOpen && (
                <Box
                  sx={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    pt: 1, // Padding top acts as a transparent bridge
                    zIndex: 10004,
                  }}
                >
                  <Box
                    sx={{
                      bgcolor: "white",
                      borderRadius: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      minWidth: "250px",
                      py: 1,
                    }}
                  >
                    {menuConfig.items.map((item) => (
                      <Box key={item.label}>
                        {/* Divider before special items */}
                        {(item as any).divider && (
                          <Box
                            sx={{ my: 1, borderTop: "1px solid #eee", mx: 2 }}
                          />
                        )}
                        <Link to={item.href} style={{ textDecoration: "none" }}>
                          <Box
                            sx={{
                              px: 3,
                              py: 1.5,
                              cursor: "pointer",
                              "&:hover": {
                                bgcolor: "#f5f5f5",
                              },
                            }}
                          >
                            <Typography
                              sx={{
                                color: "#2F302F",
                                fontSize: "0.95rem",
                                fontWeight: 500,
                              }}
                            >
                              {item.label}
                            </Typography>
                          </Box>
                        </Link>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          </Stack>
        </Box>

        {/* Right Side: Search + Icons + Auth */}
        <Stack
          direction="row"
          spacing={2}
          sx={{ flexShrink: 0, alignItems: "center" }}
        >
          {isLoading ? (
            // Skeleton Loader
            <Stack direction="row" spacing={2} alignItems="center">
              {/* Search Skeleton */}
              <Box
                sx={{
                  width: { xs: "150px", md: "250px" },
                  height: "32px",
                  bgcolor: "rgba(0,0,0,0.05)",
                  borderRadius: "16px",
                }}
                className="animate-pulse"
              />
              {/* Icons Skeleton */}
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: "rgba(0,0,0,0.05)",
                  borderRadius: "50%",
                }}
                className="animate-pulse"
              />
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: "rgba(0,0,0,0.05)",
                  borderRadius: "50%",
                }}
                className="animate-pulse"
              />
              {/* Avatar Skeleton */}
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: "rgba(0,0,0,0.05)",
                  borderRadius: "50%",
                }}
                className="animate-pulse"
              />
            </Stack>
          ) : isAuthenticated ? (
            <>
              {/* Search Bar */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  backgroundColor: "#F5F5F5",
                  borderRadius: "16px",
                  px: 1.5,
                  py: 0.5,
                  minWidth: { xs: "150px", md: "250px" },
                  transition: "all 0.3s ease",
                  "&:hover": {
                    backgroundColor: "#EBEBEB",
                  },
                  "&:focus-within": {
                    backgroundColor: "#FFFFFF",
                    boxShadow: "0 0 0 2px var(--primary)",
                  },
                }}
              >
                <Search
                  size={18}
                  style={{ color: "#666", marginRight: "6px" }}
                />
                <InputBase
                  placeholder="Search..."
                  sx={{
                    flex: 1,
                    fontSize: "0.85rem",
                    color: "#2F302F",
                    "& input::placeholder": {
                      color: "#999",
                      opacity: 1,
                    },
                  }}
                />
              </Box>

              {/* Message Icon */}
              <IconButton
                sx={{
                  color: "#2F302F",
                  "&:hover": {
                    backgroundColor: "rgba(0, 0, 0, 0.04)",
                  },
                }}
                aria-label="Messages"
              >
                <MessageCircle size={20} />
              </IconButton>

              {/* Notification Icon */}
              <IconButton
                sx={{
                  color: "#2F302F",
                  "&:hover": {
                    backgroundColor: "rgba(0, 0, 0, 0.04)",
                  },
                }}
                aria-label="Notifications"
                onClick={openNotifications}
              >
                <Badge
                  badgeContent={unreadCount > 99 ? "99+" : unreadCount}
                  color="error"
                >
                  <Bell size={20} />
                </Badge>
              </IconButton>

              <Menu
                anchorEl={notificationAnchor}
                open={Boolean(notificationAnchor)}
                onClose={closeNotifications}
                disableScrollLock
                PaperProps={{
                  sx: {
                    width: 360,
                    maxWidth: "90vw",
                    borderRadius: "12px",
                    mt: 1,
                  },
                }}
              >
                <Box className="px-4 py-3 flex items-center justify-between">
                  <Typography sx={{ fontSize: "0.95rem", fontWeight: 700 }}>
                    Notifications
                  </Typography>
                  <button
                    type="button"
                    onClick={() => markAllReadMutation.mutate()}
                    className="text-xs text-[#ff9933] hover:underline disabled:opacity-60"
                    disabled={
                      markAllReadMutation.isPending || unreadCount === 0
                    }
                  >
                    Mark all read
                  </button>
                </Box>
                <Divider />

                {recentNotifications.length === 0 ? (
                  <Box className="px-4 py-8 text-center text-sm text-gray-500">
                    No notifications yet.
                  </Box>
                ) : (
                  recentNotifications.map((notification) => {
                    const typeName = notification.type?.name;
                    const title =
                      typeName === "project_invite_received"
                        ? "New project invite"
                        : typeName === "project_invite_responded"
                          ? "Invite response"
                          : typeName === "marketplace_profile_live"
                            ? "Profile is live"
                            : "Notification";

                    const messageValue = notification.content?.message;
                    const statusValue = notification.content?.status;
                    const inviteIdValue = notification.content?.invite_id;
                    const message =
                      typeof messageValue === "string" && messageValue.trim()
                        ? messageValue
                        : typeof statusValue === "string"
                          ? `Invite was ${statusValue}.`
                          : "You have a new update.";

                    return (
                      <MenuItem
                        key={notification.id}
                        onClick={() =>
                          handleNotificationClick(
                            notification.id,
                            notification.link_url,
                            typeName,
                            typeof inviteIdValue === "string"
                              ? inviteIdValue
                              : null,
                          )
                        }
                        sx={{
                          display: "flex",
                          alignItems: "flex-start",
                          whiteSpace: "normal",
                          backgroundColor: notification.is_read
                            ? "transparent"
                            : "#fff8f3",
                          borderBottom: "1px solid #f8fafc",
                          py: 1.5,
                          px: 2,
                        }}
                      >
                        <Box sx={{ flex: 1, pr: 2 }}>
                          <Typography
                            sx={{
                              fontSize: "0.85rem",
                              fontWeight: notification.is_read ? 500 : 700,
                              color: notification.is_read
                                ? "#475569"
                                : "#0f172a",
                            }}
                          >
                            {title}
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: "0.8rem",
                              color: notification.is_read
                                ? "#64748b"
                                : "#334155",
                              mt: 0.25,
                              fontWeight: notification.is_read ? 400 : 500,
                            }}
                          >
                            {message}
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: "0.75rem",
                              color: "#94a3b8",
                              mt: 0.5,
                            }}
                          >
                            {new Date(notification.created_at).toLocaleString()}
                          </Typography>
                        </Box>
                        {!notification.is_read && (
                          <Box
                            sx={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              bgcolor: "#ff9933",
                              mt: 1,
                              flexShrink: 0,
                              boxShadow: "0 0 8px rgba(255, 153, 51, 0.5)",
                            }}
                          />
                        )}
                      </MenuItem>
                    );
                  })
                )}

                <Divider />
                <Box className="px-4 py-2">
                  <Link
                    to="/notifications"
                    className="text-sm text-[#ff9933] hover:underline"
                    onClick={closeNotifications}
                  >
                    View all notifications
                  </Link>
                </Box>
              </Menu>

              {/* User Menu */}
              <UserMenu />
            </>
          ) : (
            <>
              <Link to="/auth/login">
                <Button variant="outlined" colorScheme="primary">
                  Login
                </Button>
              </Link>
              <Link to="/auth/signup">
                <Button variant="contained" colorScheme="primary">
                  Sign Up
                </Button>
              </Link>
            </>
          )}
        </Stack>
      </Box>
    </div>
  );
};

export default DashboardHeader;
