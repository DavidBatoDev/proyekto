export interface QaFixtureManifest {
  key: string;
  project_id: string;
  contract_id: string;
  consultant_user_id: string;
  worker_user_id: string;
  client_user_id: string;
  primary_team_id: string;
  secondary_team_id: string;
}

export const QA_FIXTURE_SIDE_EFFECT_BLOCKED =
  'QA_FIXTURE_SIDE_EFFECT_BLOCKED' as const;
