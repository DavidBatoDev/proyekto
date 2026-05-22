export type EngagementStage =
  | "discovery_call"
  | "proposal_creation"
  | "active_delivery"
  | "project_closure";

export interface FormData {
  // Step 1
  clientName: string;
  category: string[];
  description: string;
  problemSolving?: string;
  engagementStage: EngagementStage;

  // Step 2
  skills: string[];
  customSkills: string[];
  duration: string;
  preview_url?: string;
}
