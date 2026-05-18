# Proyekto

Proyekto is a managed work delivery platform for digital projects. It combines the speed of freelance hiring with the structure of agency-style execution by introducing a dedicated Consultant layer between Clients and Freelancers.

Instead of leaving clients to manage technical details alone, Proyekto is designed so project vision, delivery planning, collaboration, and accountability all live in one workspace.

## What Proyekto Solves

Traditional freelance marketplaces are flexible but often chaotic. Agency models are structured but can be expensive and rigid.

Proyekto is built to bridge that gap by providing:
- Clear delivery ownership through a Consultant (project lead)
- Structured roadmap execution from kickoff to completion
- Shared visibility across client-facing and internal work
- Milestone-based payment checkpoints tied to progress

## How Proyekto Works

Proyekto uses a persona-based model. A single user can operate in different roles across different projects.

- Client: Defines goals, approves direction, tracks project health
- Consultant: Translates vision into execution plans and manages delivery
- Freelancer: Delivers scoped work items and updates progress
- Admin: Oversees platform quality, vetting, and governance

This allows one account to support multiple working contexts without fragmented logins or separate products.

## Core Product Experience

Each project acts as a structured container for delivery:
- Hybrid roadmap with milestones, epics, features, and tasks
- Collaboration channels for all-hands, team, and direct communication
- Meeting coordination and project timeline alignment
- Project brief, activity history, and progress tracking
- Payment checkpoints integrated into delivery flow

## Platform Principles

- Delivery-first: planning and execution are first-class, not an afterthought
- Role clarity: each persona has clear responsibilities and permissions
- Transparency: stakeholders see the right level of detail at the right time
- Quality control: consultant vetting and admin governance support reliable outcomes

## Tech Stack Focus

### Frontend

- React 19
- TanStack Router
- TanStack Query
- TanStack Table
- Vite
- TypeScript
- MUI + Tailwind CSS
- Zustand
- DnD Kit

### Backend

- NestJS 11
- TypeScript
- Modular architecture (controllers, services, repositories)
- Class-validator + class-transformer
- API guards and rate limiting with NestJS middleware/modules

### Tooling and Quality

- Web testing: Vitest + Testing Library
- Backend testing: Jest + Supertest
- Web lint/format/check: Biome
- Backend lint/format: ESLint + Prettier

### Infrastructure and Operations

- Terraform for environment provisioning
- Structured SQL migrations and backend function assets

## Architecture Snapshot

- Monorepo with clear domain separation between `web`, `backend`, `infra`, and `documentation`
- Feature-oriented backend modules (auth, projects, roadmaps, payments, admin, profile)
- Data-access abstraction through repository interfaces to keep business logic isolated
- Roadmap domain modeled as milestones, epics, features, tasks, comments, and attachments

## Repository Structure

- `web/`: React + TanStack application
- `backend/`: NestJS API and domain services
- `infra/`: Infrastructure-as-code definitions
- `documentation/`: Product, backend, and architecture references


