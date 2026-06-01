import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Users, Link2, Plus, Trash2, Check } from "lucide-react";
import type { ShareRole, InvitedUser, RoadmapShare } from "@/types/roadmap";
import { roadmapSharesServiceAPI } from "@/services/roadmap-shares.service";
import { projectService } from "@/services/project.service";

interface ShareRoadmapModalProps {
  isOpen: boolean;
  onClose: () => void;
  roadmapId: string;
  roadmapName: string;
  projectId?: string;
}

type Tab = "invite" | "link";

// Role options for email invitations (all roles available)
const INVITE_ROLE_OPTIONS: { value: ShareRole; label: string; description: string }[] = [
  {
    value: "viewer",
    label: "Viewer",
    description: "Can view the roadmap",
  },
  {
    value: "commenter",
    label: "Commenter",
    description: "Can view and comment",
  },
  {
    value: "editor",
    label: "Editor",
    description: "Can view, comment, and edit",
  },
];

// Role options for public links (no editor access for security)
const PUBLIC_LINK_ROLE_OPTIONS: { value: ShareRole; label: string; description: string }[] = [
  {
    value: "viewer",
    label: "Viewer",
    description: "Can view the roadmap",
  },
  {
    value: "commenter",
    label: "Commenter",
    description: "Can view and comment",
  },
];

export const ShareRoadmapModal = ({
  isOpen,
  onClose,
  roadmapId,
  roadmapName,
  projectId,
}: ShareRoadmapModalProps) => {
  const [activeTab, setActiveTab] = useState<Tab>("invite");
  const [loading, setLoading] = useState(false);
  const [shareSettings, setShareSettings] = useState<RoadmapShare | null>(null);
  const [shareUrl, setShareUrl] = useState<string>("");
  
  // Invite tab state
  const [emailInput, setEmailInput] = useState("");
  const [selectedRole, setSelectedRole] = useState<ShareRole>("viewer");
  const [invitedEmails, setInvitedEmails] = useState<InvitedUser[]>([]);
  
  // Link tab state
  const [linkEnabled, setLinkEnabled] = useState(false);
  const [defaultRole, setDefaultRole] = useState<ShareRole>("viewer");
  const [copied, setCopied] = useState(false);
  
  // Load existing share settings
  useEffect(() => {
    if (isOpen) {
      loadShareSettings();
    }
  }, [isOpen, roadmapId]);

  const loadShareSettings = async () => {
    try {
      setLoading(true);
      const settings = await roadmapSharesServiceAPI.sharing.getShareSettings(roadmapId);
      
      if (settings) {
        setShareSettings(settings);
        setShareUrl(settings.share_url);
        setInvitedEmails(settings.invited_emails || []);
        setDefaultRole(settings.default_role);
        setLinkEnabled(settings.is_active);
      } else {
        // No existing share, reset to defaults
        setShareSettings(null);
        setShareUrl("");
        setInvitedEmails([]);
        setDefaultRole("viewer");
        setLinkEnabled(false);
      }
    } catch (error) {
      console.error("Failed to load share settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddEmail = () => {
    const trimmedEmail = emailInput.trim().toLowerCase();
    
    if (!trimmedEmail) return;
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      alert("Please enter a valid email address");
      return;
    }
    
    // Check for duplicates
    if (invitedEmails.some((inv) => inv.email === trimmedEmail)) {
      alert("This email is already invited");
      return;
    }
    
    setInvitedEmails([...invitedEmails, { email: trimmedEmail, role: selectedRole }]);
    setEmailInput("");
  };

  const handleRemoveEmail = (email: string) => {
    setInvitedEmails(invitedEmails.filter((inv) => inv.email !== email));
  };

  const handleSaveInvites = async () => {
    if (!projectId) {
      alert("Cannot send invitations: project context is missing.");
      return;
    }
    if (invitedEmails.length === 0) {
      alert("Add at least one email address before saving.");
      return;
    }
    try {
      setLoading(true);
      const inviteResults = await Promise.all(
        invitedEmails.map((inv) =>
          projectService.inviteByEmail(projectId, {
            email: inv.email,
            default_role: inv.role === "editor" ? "editor" : "viewer",
          }),
        ),
      );
      setInvitedEmails([]);
      const failedEmails = inviteResults
        .filter((result) => result.email_delivery?.sent === false)
        .map((result) => result.invitee_email)
        .filter((email): email is string => Boolean(email && email.trim().length > 0));
      if (failedEmails.length > 0) {
        alert(
          `Invites were created, but email delivery failed for: ${failedEmails.join(", ")}. Share the invite link manually.`,
        );
      } else {
        alert("Invitations sent successfully!");
      }
    } catch (error) {
      console.error("Failed to send invitations:", error);
      alert("Failed to send invitations. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLink = async () => {
    if (linkEnabled) {
      // Disable sharing
      try {
        setLoading(true);
        await roadmapSharesServiceAPI.sharing.disableSharing(roadmapId);
        setLinkEnabled(false);
        setShareUrl("");
        setShareSettings(null);
        alert("Public link sharing disabled");
      } catch (error) {
        console.error("Failed to disable sharing:", error);
        alert("Failed to disable sharing. Please try again.");
      } finally {
        setLoading(false);
      }
    } else {
      // Enable sharing
      try {
        setLoading(true);
        const result = await roadmapSharesServiceAPI.sharing.shareRoadmap(roadmapId, {
          invitedEmails,
          defaultRole,
          expiresAt: undefined,
        });
        
        setShareSettings(result);
        setShareUrl(result.share_url);
        setLinkEnabled(true);
      } catch (error) {
        console.error("Failed to enable sharing:", error);
        alert("Failed to enable sharing. Please try again.");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleUpdateDefaultRole = async (role: ShareRole) => {
    setDefaultRole(role);
    
    if (linkEnabled && shareSettings) {
      try {
        setLoading(true);
        const result = await roadmapSharesServiceAPI.sharing.shareRoadmap(roadmapId, {
          invitedEmails,
          defaultRole: role,
          expiresAt: undefined,
        });
        
        setShareSettings(result);
      } catch (error) {
        console.error("Failed to update default role:", error);
        alert("Failed to update access level. Please try again.");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleCopyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Share Roadmap</h2>
            <p className="text-sm text-gray-500 mt-1">{roadmapName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab("invite")}
            className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === "invite"
                ? "text-primary border-b-2 border-primary"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Users size={16} className="inline-block mr-2" />
            Invite People
          </button>
          <button
            onClick={() => setActiveTab("link")}
            className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === "link"
                ? "text-primary border-b-2 border-primary"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Link2 size={16} className="inline-block mr-2" />
            Share Link
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "invite" && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Invite by email
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAddEmail()}
                    placeholder="email@example.com"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as ShareRole)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {INVITE_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAddEmail}
                    className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
                  >
                    <Plus size={20} />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Users will gain access when they log in with this email
                </p>
              </div>

              {/* Invited Users List */}
              {invitedEmails.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">
                    Invited People ({invitedEmails.length})
                  </h3>
                  <div className="space-y-2">
                    {invitedEmails.map((invite) => (
                      <div
                        key={invite.email}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary">
                              {invite.email[0].toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm text-gray-700">{invite.email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 capitalize">
                            {invite.role}
                          </span>
                          <button
                            onClick={() => handleRemoveEmail(invite.email)}
                            className="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Role Descriptions */}
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">
                  Access Levels
                </h4>
                <ul className="space-y-1 text-xs text-blue-800">
                  {INVITE_ROLE_OPTIONS.map((option) => (
                    <li key={option.value}>
                      <strong>{option.label}:</strong> {option.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {activeTab === "link" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-700">
                    Enable public link
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Anyone with the link can access this roadmap
                  </p>
                </div>
                <button
                  onClick={handleToggleLink}
                  disabled={loading}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    linkEnabled ? "bg-primary" : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      linkEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {linkEnabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Default access level for link
                    </label>
                    <select
                      value={defaultRole}
                      onChange={(e) => handleUpdateDefaultRole(e.target.value as ShareRole)}
                      disabled={loading}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {PUBLIC_LINK_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} - {option.description}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Share link
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={shareUrl}
                        readOnly
                        className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-600"
                      />
                      <button
                        onClick={handleCopyLink}
                        className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
                      >
                        {copied ? (
                          <>
                            <Check size={16} />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy size={16} />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                    <p className="text-xs text-yellow-800">
                      <strong>Note:</strong> Anyone with this link can access the
                      roadmap with {defaultRole} permissions. Invited users will have
                      their specific access level regardless of this setting.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            Close
          </button>
          {activeTab === "invite" && (
            <button
              onClick={handleSaveInvites}
              disabled={loading || invitedEmails.length === 0}
              className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
