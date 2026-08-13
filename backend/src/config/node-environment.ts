export const nodeEnvironment = process.env.NODE_ENV ?? 'production';

// Establish the default before tracing or Nest configuration reads the process
// environment. Development commands set NODE_ENV explicitly.
process.env.NODE_ENV = nodeEnvironment;

export const backendEnvFilePaths =
  nodeEnvironment === 'development'
    ? ['.env.development.local', 'backend/.env.development.local']
    : nodeEnvironment === 'test'
      ? [
          '.env.test.local',
          'backend/.env.test.local',
          '.env.development.local',
          'backend/.env.development.local',
        ]
      : [
          '.env.production.local',
          'backend/.env.production.local',
          '.env',
          'backend/.env',
        ];
