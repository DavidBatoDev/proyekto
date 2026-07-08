---
# Project Overview: Proyekto Work Hub

Proyekto Work Hub is a managed SaaS platform redefining the gig economy by bridging open freelance marketplaces (like Upwork) and managed agencies. Unlike traditional platforms where clients manage freelancers directly, Proyekto introduces a mandatory Consultant (Project Manager) layer to ensure quality, roadmap adherence, and technical translation between the Client and the Talent.
---

## 1. Core philosophy & authentication

### The unified identity model

- **Persona-based system** â€” instead of rigid account types (Client vs. Freelancer), users can activate different personas depending on what they want to do.
- **Single Sign-On (SSO)** â€” users sign in once (no separate login pages per role).
- **Canva-style dashboard** â€” the dashboard adapts to the active persona:
  - **"I want to propose a project"** â†’ activates **Client** persona
  - **"I want to find work"** â†’ activates **Freelancer** persona
  - **"Manage assigned projects"** â†’ activates **Consultant** persona (requires Admin vetting)

---

## 2. User roles & hierarchy

### A. The Client (The Visionary)

- **Primary goal:** Build a product without managing day-to-day technical details.
- **Workflow:** Submits a project brief; Admin assigns a Consultant; Client approves high-level roadmap and budget.
- **Capabilities:**
  - View project health (dashboard)
  - Book status meetings via integrated calendar
  - View "client-ready" milestones (abstracted from technical tasks)

### B. The Consultant (The Bridge / PM)

- **Primary goal:** Translate client vision into technical roadmaps and manage the delivery team.
- **Restriction:** Must pass a vetting/KYC process by Admin to act as Consultant.
- **Capabilities:**
  - Post job offers (fixed/hourly)
  - Define phases and milestones (roadmap structure: Start â†’ Work Items â†’ Payment Checkpoints â†’ Meetings â†’ End)
  - Approve freelancer work logs and authorize milestone payments
  - Can act as consultant in one project and be hired as a freelancer in another

### C. The Freelancer (The Builder)

- **Primary goal:** Complete assigned tasks/deliverables.
- **Capabilities:**
  - Accept/reject job offers
  - Log hours (hourly) or submit deliverables (fixed)
  - Post updates to the roadmap

### D. The Admin (The Governor)

- **Primary goal:** Platform quality assurance.
- **Capabilities:**
  - Review and approve Consultant applications
  - Assign initial Consultant to new client projects (matchmaking)
  - Handle dispute resolution and global settings

---

## 3. Project architecture

The Project Instance is a self-contained ecosystem that includes multiple modules.

### Module A â€” Hybrid Linear Roadmap (UI/UX)

The roadmap is the core view where phases, milestones, and payment checkpoints live.

### Module B â€” Communications Suite

- **Chat topology:**
  - **All-Hands:** Client + Consultant + Freelancers (Consultant can mute/archive)
  - **Dev-Team:** Consultant + Freelancers (internal technical discussions)
  - **Direct:** Consultant â†” Client (1:1)
- **Smart calendar:** Weekly view similar to Teams
- **Dynamic logo picker:** If a user pastes a meeting link (e.g., `meet.google.com`, `zoom.us`, `teams.microsoft.com`), show the appropriate meeting icon

### Module C â€” IAM (Identity & Access Management) Policy Engine

- Granular permissions inspired by GCP IAM (not just binary allow/deny)
- **Owner** role has full access
- **Custom roles** can be created (example: `Junior Dev` with permissions like `roadmap.view`, `chat.write`, `budget.view: false`)

---

## 4. Additional necessary features (recommendations)

### A. Financial & Escrow Module

- **Milestone escrow**: client deposits funds for a phase
- **Cascade payment flow** when a phase is marked complete and approved:
  - Platform fee (X%)
  - Consultant management fee (Y%)
  - Remaining funds split among freelancers based on approved logs/contracts
- **Wallet**: shows Pending, In Escrow, Available balances

### B. Consultant score & reputation system

- Public rating for Consultants (success score, vetting badges, skill stack display)

### C. Automated "stand-up" bot

- Daily prompts to the Dev-Team: "What did you accomplish yesterday? What are you doing today? Any blockers?"; compiles a summary for the Consultant

### D. Asset & file repository

- Centralized project storage (Designs, Contracts, Builds) with simple versioning for uploaded files

---

## 5. User & project structure

### Users

- A single person can play multiple roles across projects: Client, Consultant, Freelancer, project creator, approver, reviewer, collaborator

### Projects

- A container for everything: roadmap, work items, meetings, payment checkpoints, team, project brief, budgets, activity history, AI insights
- Each project has a **Client** (funding party) and a **Consultant** (project owner/manager); freelancers are optional

### Work items (milestones / tasks)

- Properties: description, dates, assignees, subtasks, review/approval status, visibility (internal vs client-visible), blockable
- Types: Deliverable, Task, Asset, Issue/Bug, Setup/Integration, Design work, Development work

### Meetings

- Types: client-consultant, consultant-freelancer, kickoff, design review, Q&A, scope clarification, retainer sync
- Meetings appear inside the roadmap and (optionally) a Meetings tab

### Payment checkpoint

- Financial object that appears in the roadmap (does not show amounts in roadmap UI)
- Tied to Payments tab where amounts live; can be approved/paid/pending
- Two subtypes:
  - Client â†’ Consultant checkpoints (funding events, installments, final payments)
  - Consultant â†’ Freelancers checkpoints (payout requests, completion payouts, monthly recurring payouts)

### Project brief

- High-level source of truth: summary, scope, requirements, constraints, risks, notes; sections can be client-visible or consultant-only

---

