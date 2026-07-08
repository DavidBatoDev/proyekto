Great. Let’s write this like internal product documentation your team can actually follow.

---

# 📘 Roadmap & Milestone System Design

## Epic-Based Value Roadmap Architecture

---

# 1️⃣ Core Philosophy

## 1.1 Epics Are Value-Based

An **Epic** represents a large, user-facing outcome that delivers business value.

Epics are NOT:

* Frontend
* Backend
* DevOps
* Database
* Infrastructure layers

Epics ARE:

* “User Authentication System”
* “Booking & Payment Flow”
* “Admin Dashboard”
* “Real-Time Notification System”

> Epic = Business value initiative

---

## 1.2 Feature Definition

A **Feature** is a concrete capability that contributes to completing an Epic.

Examples under “Booking & Payment Flow”:

* Reservation creation
* Payment gateway integration
* Booking confirmation email
* Booking history page

> Feature = Time-bound deliverable

---

## 1.3 Task Definition

A **Task** is an implementation-level unit of work.

Examples:

* Create booking API endpoint
* Build reservation form UI
* Integrate Stripe SDK
* Write migration for bookings table

> Task = Execution step

---

# 2️⃣ Hierarchy Structure

```
Roadmap
 └── Epic (Value-Based)
      └── Feature (Deliverable)
           └── Task (Implementation)
```

---

# 3️⃣ Data Model Design

We use a single flexible table structure.

## 3.1 See our database schema for this

# 4️⃣ View Responsibilities

---

# 🗺 Roadmap View (Hierarchy View)

### Purpose:

Strategic planning and structural organization.

### Displays:

* Epic
* Feature
* Task

### UI Behavior:

* Status indicators
* Progress percentage
* Optional date display

### Focus:

Structure, ownership, decomposition.

---

# 📊 Milestone View (Gantt Chart)

### Purpose:

Timeline visualization of deliverables.

### Displays:

* Features (default)
* Optional: Epics
* Never display Tasks by default

### Why Not Tasks?

Tasks are:

* Too granular
* Too volatile
* Too noisy for timeline view

---

# 5️⃣ Date Rules & Governance

---

## 5.1 Scheduling Rules

### Feature Dates

Features must have:

* start_date
* end_date

These define timeline bars.

---

## 5.2 Epic Dates (Auto-Derived)

Epic dates are automatically calculated:

```
Epic.start_date = MIN(child feature start_date)
Epic.end_date   = MAX(child feature end_date)
```

Epics do not require manual date entry.

Optional: allow manual override with “Lock Dates” toggle.

---

## 5.3 Task Dates

Tasks:

* May have optional due_date
* Do NOT affect Gantt rendering directly
* Used only for execution tracking

---

# 6️⃣ Handling Gaps in Epics

If an Epic has:

Feature A → Jan 1 – Feb 28
Feature B → Apr 1 – Dec 30

Epic will compute:

Jan 1 – Dec 30

Even if March has no activity.

This is intentional.

Reason:
Epic represents initiative lifespan, not continuous activity.

We accept internal gaps.

---

# 7️⃣ Milestone View Rendering Logic

---

## 7.1 Default Mode

Display Level: Features

Grouped visually under their Epic.

Example:

Epic: Booking & Payment

[Reservation Creation]   Jan — Feb
[Payment Integration]           Apr — May
[Confirmation Emails]              Jun

---

## 7.2 Optional Display Modes

Dropdown:

* Epics Only
* Features Only (default)
* Epics + Features

---

# 8️⃣ Progress Calculation

---

## 8.1 Feature Progress

```
Feature.progress =
  (completed tasks / total tasks) * 100
```

---

## 8.2 Epic Progress

```
Epic.progress =
  average(feature.progress)
```

OR weighted by duration.

---

# 9️⃣ Conflict Resolution Rules

---

## 9.1 If Feature Date Exceeds Epic (Manual Lock Case)

If Epic is manually locked:

* Prevent Feature date overflow
* Show validation message

If Epic is auto:

* Epic auto-expands

---

## 9.2 Recommended Default

* Epic dates = auto
* Feature dates = manual
* Tasks = flexible

---

# 10️⃣ Example Real Structure

Instead of:

❌ Epic: Frontend
❌ Epic: Backend

Use:

✅ Epic: User Authentication

* Feature: Login Flow
* Feature: Registration Flow
* Feature: Password Reset

✅ Epic: Booking System

* Feature: Reservation Creation
* Feature: Payment Integration
* Feature: Booking History

Frontend + Backend tasks live inside features.

---

# 11️⃣ Strategic vs Execution Separation

| Layer   | Focus                | Visible In               |
| ------- | -------------------- | ------------------------ |
| Epic    | Business Value       | Roadmap & optional Gantt |
| Feature | Deliverable Timeline | Gantt                    |
| Task    | Execution Work       | Roadmap only             |

---

# 12️⃣ Product Principles

1. One data model.
2. Multiple visualizations.
3. No duplicate mapping.
4. No separate roadmap system.
5. Views are projections, not separate entities.

---

# 13️⃣ Final Architecture Summary

Roadmap View = Structural Planning
Milestone View = Timeline Projection
Epics = Value-Based Initiatives
Features = Timeline Units
Tasks = Execution Units

