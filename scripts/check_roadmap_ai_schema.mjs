import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const schemaPath = path.join(root, 'schemas', 'roadmap-ai-operations.json');
const backendDtoPath = path.join(
  root,
  'backend',
  'src',
  'modules',
  'roadmaps',
  'dto',
  'roadmap-ai.dto.ts',
);
const agentOpsPath = path.join(
  root,
  'agent',
  'app',
  'core',
  'contracts',
  'operations.py',
);
const agentRegistryPath = path.join(
  root,
  'agent',
  'app',
  'core',
  'tools',
  'registry.py',
);

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractTsUnion(content, aliasName) {
  const pattern = new RegExp(`export type ${aliasName} =([\\s\\S]*?);`, 'm');
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Could not find TypeScript alias: ${aliasName}`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function extractTsClassBody(content, className) {
  const pattern = new RegExp(`export class ${className} \\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Could not find TypeScript class: ${className}`);
  }
  return match[1];
}

function extractTsClassFields(content, className) {
  const body = extractTsClassBody(content, className);
  const fields = [];
  const matches = body.matchAll(/\n\s*([a-z_][a-z0-9_]*)\??:\s*[^;\n]+;/g);
  for (const match of matches) {
    fields.push(match[1]);
  }
  return fields;
}

function extractPythonEnumValues(content, className) {
  const pattern = new RegExp(
    `class ${className}\\(str, Enum\\):([\\s\\S]*?)(?=\\r?\\n\\r?\\nclass\\s+\\w+\\(|$)`,
  );
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Could not find Python enum: ${className}`);
  }
  return [...match[1].matchAll(/=\s*'([^']+)'/g)].map((item) => item[1]);
}

function extractPythonClassFields(content, className) {
  const pattern = new RegExp(
    `class ${className}\\(BaseModel\\):([\\s\\S]*?)(?=\\r?\\n\\r?\\nclass\\s+\\w+\\(|$)`,
  );
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Could not find Python class: ${className}`);
  }
  const fields = [];
  const matches = match[1].matchAll(/\n\s*([a-z_][a-z0-9_]*)\s*:\s*[^\n]+/g);
  for (const item of matches) {
    if (item[1] !== 'model_config') {
      fields.push(item[1]);
    }
  }
  return fields;
}

function compare(label, expected, actual) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    return null;
  }
  return `${label} mismatch\n  expected=${JSON.stringify(expected)}\n  actual=${JSON.stringify(actual)}`;
}

function main() {
  const schema = JSON.parse(readUtf8(schemaPath));
  const backendContent = readUtf8(backendDtoPath);
  const agentContent = readUtf8(agentOpsPath);
  const registryContent = readUtf8(agentRegistryPath);

  const failures = [];
  const checks = [
    compare(
      'backend.operation_types',
      schema.operation_types ?? [],
      extractTsUnion(backendContent, 'RoadmapAiOperationType'),
    ),
    compare(
      'backend.node_types',
      schema.node_types ?? [],
      extractTsUnion(backendContent, 'RoadmapNodeType'),
    ),
    compare(
      'agent.operation_types',
      schema.operation_types ?? [],
      extractPythonEnumValues(agentContent, 'OperationType'),
    ),
    compare(
      'agent.node_types',
      schema.node_types ?? [],
      extractPythonEnumValues(agentContent, 'NodeType'),
    ),
    compare(
      'backend.operation_fields',
      schema.operation_fields ?? [],
      extractTsClassFields(backendContent, 'RoadmapAiOperationDto'),
    ),
    compare(
      'agent.operation_fields',
      schema.operation_fields ?? [],
      extractPythonClassFields(agentContent, 'RoadmapOperation'),
    ),
    compare(
      'agent.resolver_tool.required',
      schema.resolver_tool?.required ?? [],
      extractRegistryToolRequiredArgs(
        registryContent,
        schema.resolver_tool?.name ?? 'resolve_node_reference',
      ),
    ),
  ];

  for (const check of checks) {
    if (check) failures.push(check);
  }

  if (failures.length > 0) {
    console.error('Roadmap AI operation schema drift detected:');
    for (const item of failures) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }

  console.log('Roadmap AI operation schema check passed.');
}

function extractRegistryToolRequiredArgs(content, toolName) {
  const namePattern = new RegExp(
    `'name':\\s*'${toolName}'([\\s\\S]*?)'parameters':\\s*\\{([\\s\\S]*?)\\}\\s*,?\\s*\\},`,
    'm',
  );
  const nameMatch = content.match(namePattern);
  if (!nameMatch) {
    throw new Error(`Could not find tool definition in registry: ${toolName}`);
  }
  const parametersChunk = nameMatch[2];
  const requiredMatch = parametersChunk.match(/'required':\s*\[([^\]]*)\]/m);
  if (!requiredMatch) {
    throw new Error(`Could not find required args for tool: ${toolName}`);
  }
  return [...requiredMatch[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

main();
