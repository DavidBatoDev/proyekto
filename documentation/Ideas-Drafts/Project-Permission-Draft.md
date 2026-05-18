# 1
Here is the refined **Permission Matrix** and the **Default Templates** for the current state of Proyekto.

---

## ðŸ›ï¸ Refined Permission Matrix

| Permission Key | Description |
| --- | --- |
| **`roadmap.edit`** | Create, update, or delete Epics, Features, and Tasks. |
| **`roadmap.view_internal`** | See technical notes or internal-only tasks hidden from the Client. |
| **`roadmap.comment`** | Add comments/feedback to any roadmap item. |
| **`roadmap.promote`** | Capability to turn a standalone roadmap into a live Project. |
| **`members.manage`** | Invite new members, remove existing ones, or edit permissions. |
| **`project.settings`** | Edit project metadata (Title, Category, Brief/Mission). |
| **`project.transfer`** | Initiate a transfer of Ownership (Client) or Lead Consultant. |

---

## ðŸ—ï¸ Updated Default Permission Sets

### **1. The Client (The Visionary)**

Focused on the high-level vision and final say on who is in the project.

```json
{
  "roadmap": {
    "edit": false,
    "view_internal": false,
    "comment": true,
    "promote": false
  },
  "members": {
    "manage": true,
    "view": true
  },
  "project": {
    "settings": true,
    "transfer": true
  }
}

```

### **2. The Consultant (The Architect)**

The engine of the project. They have full control over the execution and team structure but cannot transfer ownership once a Client is attached.

```json
{
  "roadmap": {
    "edit": true,
    "view_internal": true,
    "comment": true,
    "promote": true
  },
  "members": {
    "manage": true,
    "view": true
  },
  "project": {
    "settings": true,
    "transfer": false
  }
}

```

---

## ðŸ”„ Incubation State (Verified Consultant Creator)

When a Consultant creates an **Incubation Project**, they start with a "Super Set" of permissions so they can behave as the owner until the handshake.

**Initial `permissions_json` for Consultant-Creator:**

```json
{
  "roadmap": { "edit": true, "view_internal": true, "comment": true, "promote": true },
  "members": { "manage": true, "view": true },
  "project": { "settings": true, "transfer": true }
}

```



# 2
In the **Proyekto Work Hub** architecture, project permissions are managed primarily by the **Consultant** and the **Client**, though their authority focuses on different areas of the project lifecycle.

Since you are using a **JSONB** column in the `project_members` table, management happens through a "Permission Editor" interface that updates that specific row.

---

### 1. The Managers

#### **The Consultant (The Bridge)**

The Consultant is the primary manager of **Technical and Team permissions**.

* **Role:** They invite Freelancers and determine who can edit the Roadmap vs. who can only comment.
* **Authority:** They have the `members.manage` permission. They use this to "scale" the team as the roadmap grows from Epics to Tasks.
* **Restriction:** In a standard project, they cannot remove the Client or revoke the Client's `project.transfer` rights.

#### **The Client (The Visionary/Owner)**

The Client holds **Governance authority**.

* **Role:** They oversee the Consultant and have the final say on project membership.
* **Authority:** They can manage the Consultantâ€™s permissions (though usually, these are fixed by the platform) and can authorize the **Ownership Transfer**.
* **In Incubation:** If a Consultant started the project, they act as the "Temporary Client" and manage all permissions until they hand the project over to a real Client.

#### **The Admin (The Governor)**

* **Role:** While Admins don't manage daily task permissions, they have "Super-User" access via the `admin_profiles` table to intervene in disputes or fix permission deadlocks.

---

### 2. How Permissions are Modified

Because you are using the **JSONB** approach, managing permissions doesn't require complex database migrations. It follows this flow:

1. **Selection:** A Manager (Client/Consultant) opens the **Member Page**.
2. **Interaction:** They toggle a switch (e.g., "Allow this Freelancer to edit the Roadmap").
3. **API Call:** The frontend sends a `PATCH` request to `/api/projects/:id/members/:userId`.
4. **Backend Logic:** The `ProjectMembersService` verifies that the *editor* has `members.manage: true` before updating the `permissions_json` for the *target* user.
5. **RLS Enforcement:** The moment the JSONB is updated, Supabase RLS immediately enforces the new restrictions across all Roadmap and Task tables.

---

### 3. Permission Visibility Matrix

| Persona | Can View Permissions? | Can Edit Permissions? |
| --- | --- | --- |
| **Client** | âœ… Yes | âœ… Yes (All members) |
| **Consultant** | âœ… Yes | âœ… Yes (Freelancers & Guest Managers) |
| **Freelancer** | âŒ No | âŒ No |

---


# 3
This is a crucial step for maintaining the **Trust & Authority** balance in your managed marketplace. You essentially need a "Immutable Identity" rule for the project leads, while giving the Consultant enough "Agile Autonomy" to build their team without bothering the Client for every single hire.

Here is the strategy to implement these two behaviors using your **JSONB** column and **Backend logic**.

---

### 1. Protecting the "Leads" (Immutable Permissions)

To prevent a Client or Consultant from accidentally (or maliciously) stripping their own powers or each other's core roles, you implement **Attribute-Level Locking** in your NestJS service.

**The Logic:**

* In the `ProjectMembersService.updatePermissions` method, you hardcode a check:
* If the `target_user_id` matches the `projects.client_id`, the request is **Rejected**.
* If the `target_user_id` matches the `projects.consultant_id`, the request is **Rejected**.


* **Result:** The core permissions for the "Lead" roles are only modified by the system during **Transfer Ownership** or **Admin Intervention**.

---

### 2. Auto-Approval for Consultant Invitations

Currently, your app likely has a "Request to Join" or "Invite" flow that requires the Owner's approval. To allow the Consultant to build the team autonomously, we use a **"Pre-Authorized Role"** logic.

**The Flow:**

1. **The Invitation:** The Consultant (who has `members.manage: true`) sends an invite to a Freelancer.
2. **The Bypass:** In your `ProjectInvitationsService`, you check the `inviter_id`.
* If `inviter_id == project.consultant_id`, the system sets the invitation status to `accepted` (or `pre_approved`) immediately.


3. **The Result:** When the Freelancer clicks "Accept," they are added to `project_members` with the Consultant's chosen `permissions_json` immediately, without the Client needing to click "Approve."

---

### ðŸ›ï¸ Updated Member Management Logic

| Action | Initiator | Target | Approval Required? |
| --- | --- | --- | --- |
| **Invite Freelancer** | Consultant | Freelancer | **No** (Auto-Approve) |
| **Edit Freelancer Perms** | Consultant | Freelancer | **No** |
| **Remove Freelancer** | Consultant | Freelancer | **No** |
| **Edit Consultant Perms** | Client | Consultant | **LOCKED** (System Only) |
| **Edit Client Perms** | Consultant | Client | **LOCKED** (System Only) |

---

### ðŸ› ï¸ NestJS Implementation Snippet

This is how you would enforce the "Locking" and "Auto-Approve" logic in your backend:

```typescript
// Inside ProjectMembersService
async updateMemberPermissions(editorId: string, projectId: string, targetUserId: string, newPerms: any) {
  const project = await this.projectRepo.findById(projectId);

  // 1. Immutable Guard: Cannot edit the core leads
  if (targetUserId === project.client_id || targetUserId === project.consultant_id) {
    throw new ForbiddenException("Cannot modify permissions of project leads.");
  }

  // 2. Authorization Guard: Only those with members.manage can edit others
  const editor = await this.memberRepo.findMember(projectId, editorId);
  if (!editor.permissions_json.members.manage) {
    throw new ForbiddenException("You do not have permission to manage members.");
  }

  return this.memberRepo.updatePermissions(projectId, targetUserId, newPerms);
}

```

---

### ðŸŽ¨ UI Feedback

On the **Members Page**, you should visually communicate this:

* **For Leads:** Disable the "Edit Permissions" toggle and show a "Lead Role" badge.
* **For Freelancers:** Show the toggle as active for the Consultant, with a tooltip: *"Freelancers you invite are automatically approved."*

