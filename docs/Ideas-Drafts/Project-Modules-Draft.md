Based on your current schema and the **Proyekto Work Hub** architecture, the project environment is divided into several specialized modules. Each module serves a specific persona (Client, Consultant, or Freelancer) while maintaining the **Consultant-as-a-Bridge** governance model.

---

### ðŸ›ï¸ 1. Project Strategy & Governance Module

This is the "Executive" layer where the project's identity and high-level boundaries are defined.

* **Project Overview Dashboard:** Displays the mission, vision, and real-time health vitals (Budget, Progress, Risks).
* **Strategic Brief (`project_briefs`):** Stores the contractual "Source of Truth," including the scope statement, functional requirements, and constraints.
* **Risk Register:** A managed list of technical and business risks with visibility controls to keep internal concerns hidden from the Client when necessary.
* **Ownership & Transfer Logic:** Handles the transition of a project from a Consultant-led "Incubation" phase to a Client-funded "Active" phase.

### ðŸ—ï¸ 2. Execution & Roadmap Module

This is the "Engine Room" where the technical work is organized into a four-tier hierarchy.

* **Roadmap Canvas:** A visual interface for managing high-level **Epics** and **Milestones**.
* **Work Item Management:** Handles granular **Features** and **Tasks** (Kanban/List views) for the Freelancer team.
* **Versioned Roadmaps:** Allows for "Standalone Roadmaps" that can be promoted to project instances once a Consultant is matched.
* **Deliverable Tracking:** A boolean system (`is_deliverable`) to distinguish between internal work and client-facing milestones.

### ðŸ’° 3. Financial & Escrow Module

This module manages the "Financial Cascade," ensuring everyone is paid automatically based on verified work.

* **Wallet System:** Tracks `available_balance` and `escrow_balance` for all project members.
* **Payment Checkpoints:** Links specific roadmap milestones to automated fund releases.
* **Fee Management:** Calculates and distributes the `platform_fee_percent` and `consultant_fee_percent` during the payout cascade.
* **Budget Tracking:** Provides the Client with transparency on "Burn Rate" and remaining funds.

### ðŸ¤ 4. Team & Member Management Module

This module governs who can enter the project and what they can do.

* **Member Directory:** A restricted list of all project participants and their designated roles.
* **IAM / Permissions Engine:** Uses `permissions_json` to grant granular powers like `roadmap.edit` or `members.manage`.
* **Consultant Marketplace (Internal):** Allows Consultants to scout and invite vetted Freelancers to join the project team.
* **Role Transitions:** Facilitates the "Handshake" where a Consultant transfers project ownership to a Client.

### ðŸ’¬ 5. Communication & Collaboration Module

This ensures alignment through structured, tiered channels.

* **Tiered Chat System:** Separates "All-Hands" communication (Client + Team) from "Dev-Team Only" technical discussions.
* **Project Files & Assets:** Centralized storage for project-related documents and task-specific attachments.
* **Smart Calendar:** Integrates the `meetings` table to schedule syncs, design reviews, and milestone demos.
* **Notification Engine:** Sends global and contextual alerts for task updates, mentions, and payment events.

---
