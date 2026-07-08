In the **Proyekto Work Hub**, the flow depends on the **Persona** (Client or Consultant) and the **Entry Point** (Project-first or Roadmap-first). Because the platform mandates a **Consultant Layer**, any flow initiated by a Client remains "Pending" or "Draft" until a Consultant is matched.

---

### 1. Creating a Project first (without a roadmap) by a Client

This is the **"Vision-Led"** flow, where a Client has a problem but doesn't have a technical plan yet.

1. **Submission:** The Client fills out the **Project Brief** (Title, Category, Mission/Vision).
2. **Database Entry:** A row is created in `projects` with `status = 'draft'` or `'matching'`.
3. **The Matching Gate:** The project is visible to **Admins** and **Consultants** in the Marketplace.
4. **Selection:** A Consultant bids on the project or is assigned by an Admin.
5. **Activation:** Once the Consultant joins, they create the first `roadmaps` entry linked to this `project_id`.

### 2. Creating a Roadmap first (Make a project through a roadmap) by a Client

This is the **"Draft-Led"** flow, where a Client wants to outline their own goals before hiring.

1. **Drafting:** The Client creates a standalone roadmap (no `project_id`).
2. **Blueprint:** The Client adds high-level `roadmap_epics` to describe their desired outcomes.
3. **Promotion:** The Client clicks **"Transform to Project"**.
4. **Matchmaking:** The system requires the Client to select a **Consultant** from the Marketplace to "unlock" the project.
5. **Handover:** The matched Consultant reviews the draft roadmap and officially initializes the `projects` record.

---

### 3. Creating a Project first (without a roadmap) by a Consultant

This is the **"Infrastructure-Led"** flow, often used when a Consultant is migrating an existing project to Proyekto.

1. **Initialization:** The Consultant creates a project and is assigned as both `consultant_id` and temporary `client_id`.
2. **Architecture:** The Consultant adds the technical `project_brief` details.
3. **Team Building:** The Consultant invites Freelancers to `project_members` before the Client is even involved.
4. **Handshake:** The Consultant invites a **Client** and uses the **Transfer Ownership** tool to move the `client_id` to the new user.

### 4. Creating a Roadmap first (Make a project through a roadmap) by a Consultant

This is the **"Architecture-Led"** flow, where the Consultant builds a "Package" or "Productized Service" to sell to a Client.

1. **Incubation:** The Consultant creates a standalone roadmap to design a specific technical solution.
2. **Execution Design:** The Consultant populates all `roadmap_features` and `roadmap_tasks`.
3. **Promotion:** The Consultant triggers **"Launch Project"** from the roadmap.
4. **Direct Assignment:** The `projects` record is created; the Consultant is automatically the `consultant_id`.
5. **Client Attachment:** The Consultant "Connects" a Client (either an existing one or a new invite) to the project.

---

### ðŸŽ¨ Summary Comparison

| Flow | Starting Owner | Mandatory Action | Final Outcome |
| --- | --- | --- | --- |
| **Client-Project** | Client | Must find a Consultant | Managed Project |
| **Client-Roadmap** | Client | Must promote to Project | Managed Project |
| **Consultant-Project** | Consultant | Must transfer to Client | Managed Project |
| **Consultant-Roadmap** | Consultant | Must attach a Client | Managed Project |
