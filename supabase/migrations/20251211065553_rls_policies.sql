-- Row Level Security (RLS) Policies for Proyekto Work Hub

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- ============================================
-- PROFILES POLICIES
-- ============================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- Users can view profiles of their project teammates
CREATE POLICY "Users can view teammate profiles"
    ON profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members pm1
            JOIN project_members pm2 ON pm1.project_id = pm2.project_id
            WHERE pm1.user_id = auth.uid() AND pm2.user_id = profiles.id
        )
    );

-- ============================================
-- PROJECTS POLICIES
-- ============================================

-- Project members can view their projects
CREATE POLICY "Project members can view projects"
    ON projects FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = projects.id
            AND project_members.user_id = auth.uid()
        )
    );

-- Clients can create projects
CREATE POLICY "Clients can create projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() = client_id);

-- Project owners (client or consultant) can update projects
CREATE POLICY "Project owners can update projects"
    ON projects FOR UPDATE
    USING (
        auth.uid() = client_id OR auth.uid() = consultant_id
    );

-- Only admin can delete projects
CREATE POLICY "Admin can delete projects"
    ON projects FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.active_persona = 'admin'
        )
    );

-- ============================================
-- PROJECT_MEMBERS POLICIES
-- ============================================

-- Project members can view team roster
CREATE POLICY "Project members can view team"
    ON project_members FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = project_members.project_id
            AND pm.user_id = auth.uid()
        )
    );

-- Project consultant can add members
CREATE POLICY "Consultant can add members"
    ON project_members FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_members.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- Project consultant can update member roles
CREATE POLICY "Consultant can update member roles"
    ON project_members FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_members.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- Consultant can remove members
CREATE POLICY "Consultant can remove members"
    ON project_members FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_members.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- ============================================
-- WORK_ITEMS POLICIES
-- ============================================

-- Project members can view work items
CREATE POLICY "Project members can view work items"
    ON work_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = work_items.project_id
            AND project_members.user_id = auth.uid()
        )
        -- Clients can only see client-visible work items
        AND (
            is_client_visible = TRUE OR
            auth.uid() IN (
                SELECT consultant_id FROM projects WHERE id = work_items.project_id
                UNION
                SELECT user_id FROM project_members 
                WHERE project_id = work_items.project_id 
                AND user_id != (SELECT client_id FROM projects WHERE id = work_items.project_id)
            )
        )
    );

-- Consultant can create work items
CREATE POLICY "Consultant can create work items"
    ON work_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = work_items.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- Consultant and assignees can update work items
CREATE POLICY "Consultant and assignees can update work items"
    ON work_items FOR UPDATE
    USING (
        auth.uid() = assignee_id OR
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = work_items.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- Consultant can delete work items
CREATE POLICY "Consultant can delete work items"
    ON work_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = work_items.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- ============================================
-- MILESTONES POLICIES
-- ============================================

-- Project members can view milestones
CREATE POLICY "Project members can view milestones"
    ON milestones FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = milestones.project_id
            AND project_members.user_id = auth.uid()
        )
    );

-- Consultant can create milestones
CREATE POLICY "Consultant can create milestones"
    ON milestones FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = milestones.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- Consultant can update milestones
CREATE POLICY "Consultant can update milestones"
    ON milestones FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = milestones.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- Consultant can delete milestones
CREATE POLICY "Consultant can delete milestones"
    ON milestones FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = milestones.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- ============================================
-- PAYMENT_CHECKPOINTS POLICIES
-- ============================================

-- Project members can view payment checkpoints
CREATE POLICY "Project members can view payments"
    ON payment_checkpoints FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = payment_checkpoints.project_id
            AND project_members.user_id = auth.uid()
        )
    );

-- Consultant and admin can create payment checkpoints
CREATE POLICY "Consultant and admin can create payments"
    ON payment_checkpoints FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = payment_checkpoints.project_id
            AND projects.consultant_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.active_persona = 'admin'
        )
    );

-- Consultant and admin can update payment checkpoints
CREATE POLICY "Consultant and admin can update payments"
    ON payment_checkpoints FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = payment_checkpoints.project_id
            AND projects.consultant_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.active_persona = 'admin'
        )
    );

-- ============================================
-- MEETINGS POLICIES
-- ============================================

-- Project members can view meetings
CREATE POLICY "Project members can view meetings"
    ON meetings FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = meetings.project_id
            AND project_members.user_id = auth.uid()
        )
    );

-- Project members can create meetings
CREATE POLICY "Project members can create meetings"
    ON meetings FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = meetings.project_id
            AND project_members.user_id = auth.uid()
        )
    );

-- Meeting creator can update meetings
CREATE POLICY "Meeting creator can update meetings"
    ON meetings FOR UPDATE
    USING (auth.uid() = created_by);

-- Meeting creator and consultant can delete meetings
CREATE POLICY "Creator and consultant can delete meetings"
    ON meetings FOR DELETE
    USING (
        auth.uid() = created_by OR
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = meetings.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

-- ============================================
-- CHAT_MESSAGES POLICIES
-- ============================================

-- Project members can view chat messages based on channel type
CREATE POLICY "Project members can view chat by channel"
    ON chat_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members pm
            JOIN projects p ON pm.project_id = p.id
            WHERE pm.project_id = chat_messages.project_id
            AND pm.user_id = auth.uid()
            AND (
                -- All-hands: Everyone in project
                (chat_messages.channel_type = 'all-hands') OR
                -- Dev-team: Exclude client
                (chat_messages.channel_type = 'dev-team' AND pm.user_id != p.client_id) OR
                -- Direct: Only sender and recipient
                (chat_messages.channel_type = 'direct' AND (
                    chat_messages.sender_id = auth.uid() OR 
                    chat_messages.recipient_id = auth.uid()
                ))
            )
        )
    );

-- Project members can send chat messages based on channel type
CREATE POLICY "Project members can send chat by channel"
    ON chat_messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM project_members pm
            JOIN projects p ON pm.project_id = p.id
            WHERE pm.project_id = chat_messages.project_id
            AND pm.user_id = auth.uid()
            AND (
                -- All-hands: Everyone can send
                (chat_messages.channel_type = 'all-hands') OR
                -- Dev-team: Exclude client
                (chat_messages.channel_type = 'dev-team' AND pm.user_id != p.client_id) OR
                -- Direct: Only to valid project member
                (chat_messages.channel_type = 'direct' AND EXISTS (
                    SELECT 1 FROM project_members
                    WHERE project_id = chat_messages.project_id
                    AND user_id = chat_messages.recipient_id
                ))
            )
        )
        AND auth.uid() = sender_id
    );

-- Users can update their own messages
CREATE POLICY "Users can update own messages"
    ON chat_messages FOR UPDATE
    USING (auth.uid() = sender_id);

-- Users can delete their own messages
CREATE POLICY "Users can delete own messages"
    ON chat_messages FOR DELETE
    USING (auth.uid() = sender_id);

-- ============================================
-- FILES POLICIES
-- ============================================

-- Project members can view files
CREATE POLICY "Project members can view files"
    ON files FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = files.project_id
            AND project_members.user_id = auth.uid()
        )
    );

-- Project members can upload files
CREATE POLICY "Project members can upload files"
    ON files FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM project_members
            WHERE project_members.project_id = files.project_id
            AND project_members.user_id = auth.uid()
        )
        AND auth.uid() = uploaded_by
    );

-- File uploader can update file metadata
CREATE POLICY "Uploader can update file metadata"
    ON files FOR UPDATE
    USING (auth.uid() = uploaded_by);

-- Consultant and file uploader can delete files
CREATE POLICY "Consultant and uploader can delete files"
    ON files FOR DELETE
    USING (
        auth.uid() = uploaded_by OR
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = files.project_id
            AND projects.consultant_id = auth.uid()
        )
    );

