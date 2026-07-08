Yes, adding an **Intent Selection Modal** is the most robust way to handle this flow. Since you are bypassing the `active_persona` toggle and relying on `is_consultant_verified`, a modal serves as a **"Decision Gate"** that prevents users from accidentally creating a project in the wrong state.

Without this selection, the system wouldn't know if a verified Consultant is acting as a **Client** (hiring someone else) or as a **Consultant** (managing the project themselves).

---

### 🏛️ The "Intent Gate" Modal Logic

When a verified user clicks "Create Project," the modal should present two distinct paths.

#### **Path 1: "I am a Client" (Standard Bidding)**

* **Target:** For the Consultant's personal projects or internal agency needs where they want to hire *another* professional.
* **Database Result:** Sets `status = 'bidding'` and `consultant_id = NULL`.
* **Permissions:** The user is the `client_id` and the `owner_id` of the brief.

#### **Path 2: "I am a Consultant" (Project Incubation)**

* **Target:** For the professional flow where the Consultant is architecting a solution to later "pitch" or "handover" to a funding Client.
* **Database Result:** Sets `status = 'draft'` and `consultant_id = auth.uid()`.
* **Permissions:** The user is the `client_id` (temporary owner) AND `consultant_id` (manager).

---

### 🎨 UI Design Recommendation (Shadcn/UI)

Since you are using **React 19** and **Tailwind CSS v4**, you can use a high-contrast card-based modal to make the choice feel significant.

* **Left Side (Client Card):** "Post a Request. I need a verified professional to lead this roadmap for me." (Icon: 🤝)
* **Right Side (Consultant Card):** "Incubate a Project. I will architect the roadmap and lead this project myself." (Icon: 🏗️)

---

### 🔄 The Resulting Flow in the Posting Page

Once the intent is selected in the modal, the `project-posting` page should update its instructions:

1. **If Client Intent:** Show a message: *"Your project will be sent to the Admin Matchmaking queue once submitted"*.
2. **If Consultant Intent:** Show a message: *"You are creating an Incubation Project. You will have full management control immediately"*.

### 🛠️ Why this is better than a Toggle

A toggle can be easily missed. A modal forces the user to confirm their **Legal and Financial Role** in the project before they start filling out the `project_briefs`. It ensures that the **Financial Cascade** (Platform vs. Consultant fees) is calculated correctly from the start.