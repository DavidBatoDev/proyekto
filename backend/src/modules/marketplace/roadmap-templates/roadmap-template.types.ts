export type RoadmapTemplateSchedule = {
  kind: 'long_term' | 'short_learning';
  estimated_duration_days: number;
};

export type RoadmapTemplateVersionContent = {
  contract_version: number;
  schedule_kind: 'long_term' | 'short_learning';
  roadmap: {
    name: string;
    description?: string;
    schedule_kind: 'long_term' | 'short_learning';
    start_day_offset: number;
    end_day_offset: number;
  };
  milestones: Array<{
    key: string;
    title: string;
    time_label: string;
    description?: string;
    target_day_offset: number;
    feature_keys: string[];
  }>;
  epics: Array<{
    key: string;
    title: string;
    time_label: string;
    description?: string;
    start_day_offset: number;
    end_day_offset: number;
    priority: string;
    tags: string[];
    features: Array<{
      key: string;
      title: string;
      time_label: string;
      description?: string;
      start_day_offset: number;
      end_day_offset: number;
      is_deliverable: boolean;
      tasks: Array<{
        key: string;
        title: string;
        description?: string;
        priority: string;
        position: number;
        work_type: 'real_work' | 'training';
        due_day_offset?: number;
        checklist: Array<{ id: string; title: string; completed: false }>;
      }>;
    }>;
  }>;
};

export type RoadmapTemplateSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  preview_url: string;
  category: { slug: string; name: string };
  tags: Array<{ slug: string; name: string }>;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  schedule: RoadmapTemplateSchedule;
  attribution: { name: string; url?: string | null };
  is_featured: boolean;
  published_at: string;
  view_count: number;
  use_count: number;
  duplicate_count: number;
  rating_count: number;
  rating_average: number;
  preview: {
    epics: Array<{
      id: string;
      title: string;
      position: number;
      features: Array<{ id: string; title: string }>;
    }>;
    milestone_count: number;
  };
};

export type RoadmapTemplateDetail = RoadmapTemplateSummary & {
  version_id: string;
  version_number: number;
  content: RoadmapTemplateVersionContent;
  hierarchy_counts: {
    milestones: number;
    epics: number;
    features: number;
    tasks: number;
  };
};

export type ConsultantTemplateAnalytics = {
  template_id: string;
  view_count: number;
  unique_users: number;
  duplicates: number;
  rating_count: number;
  rating_average: number;
  reports_open: number;
  recent_uses: Array<{ day: string; count: number }>;
};
