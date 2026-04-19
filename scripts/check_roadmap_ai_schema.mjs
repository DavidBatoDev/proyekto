import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const schemaPath = path.join(root, 'schemas', 'roadmap-ai-operations.json');
const canonicalSchemaPath = path.join(
  root,
  'schemas',
  'roadmap-ai-operations.schema.json',
);
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
  const direct = [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  if (direct.length > 0) return direct;
  // Alias derived from an `as const` array — e.g.
  //   export type X = (typeof ARRAY_NAME)[number];
  // Resolve through the referenced array.
  const arrayRef = match[1].match(/typeof\s+([A-Z_][A-Z0-9_]*)/);
  if (!arrayRef) {
    throw new Error(`Alias ${aliasName} has no literal values or array ref`);
  }
  return extractTsConstArray(content, arrayRef[1]);
}

function extractTsConstArray(content, arrayName) {
  const pattern = new RegExp(
    `export const ${arrayName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as\\s+const`,
    'm',
  );
  const match = content.match(pattern);
  if (!match) {
    throw new Error(`Could not find TypeScript const array: ${arrayName}`);
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
  // Stop at the first method definition — Pydantic models declare fields at
  // the top of the class body, then methods below. Matching beyond this
  // point scoops up type-annotated locals inside methods (e.g. `issues:
  // list[str]`) and even `else:` keywords, since they fit the
  // `name: type` shape.
  const body = match[1];
  const methodStart = body.search(/\n {4}def\s+\w+\(/);
  const fieldBody = methodStart === -1 ? body : body.slice(0, methodStart);
  // Constrain to exactly 4 spaces of indentation so only direct class-body
  // declarations match, not nested scopes.
  const fields = [];
  const matches = fieldBody.matchAll(/\n {4}([a-z_][a-z0-9_]*)\s*:\s*[^\n]+/g);
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
  const canonicalSchema = JSON.parse(readUtf8(canonicalSchemaPath));
  const backendContent = readUtf8(backendDtoPath);
  const agentContent = readUtf8(agentOpsPath);
  const registryContent = readUtf8(agentRegistryPath);

  const failures = [];
  const canonicalOps = Object.keys(
    canonicalSchema?.definitions?.operation_requirements?.properties ?? {},
  );
  const schemaRef = schema.schema_ref ?? null;
  const checks = [
    compare(
      'registry.schema_ref',
      './roadmap-ai-operations.schema.json',
      schemaRef,
    ),
    compare(
      'canonical.operation_types',
      schema.operation_types ?? [],
      canonicalOps,
    ),
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
    compare(
      'backend.context_search_match_fields',
      schema.context_search_match_fields ?? [],
      extractTsClassFields(backendContent, 'RoadmapAiContextSearchMatchDto'),
    ),
  ];

  // Strict-mode compatibility guard: OpenAI's strict tool schema cannot
  // enforce conditional sub-schemas (allOf/if/then, oneOf, anyOf) inside
  // operation items, so their presence silently degrades the op-enum
  // constraint to post-hoc Pydantic validation. Per-op required-field
  // rules live in RoadmapOperation.semantic_contract_issues and the
  // NestJS RoadmapAiOperationShapeConstraint; the JSON schema must stay
  // flat so sampling-time enforcement actually fires.
  const strictCompatViolation = findStrictModeViolation(canonicalSchema);
  if (strictCompatViolation) {
    failures.push(
      `canonical.operations.strict_mode_incompatible: ${strictCompatViolation}`,
    );
  }

  if (!Array.isArray(schema.operation_fields) || !schema.operation_fields.includes('targets')) {
    failures.push('registry.operation_fields missing "targets"');
  }
  const canonicalOpProps =
    canonicalSchema?.properties?.operations?.items?.properties ?? {};
  if (!canonicalOpProps.targets || canonicalOpProps.targets.type !== 'array') {
    failures.push('canonical.operations.items.properties.targets missing or not array');
  }

  // Runtime tool schema drift: the JSON the LLM actually sees when it
  // calls plan_roadmap_operations. Previously this surface drifted from
  // the canonical contract silently (missed `targets`) and caused a
  // 182-second provider-outage regression. Invoke the Python entry point
  // if available and assert field parity with the Pydantic model.
  const runtimeDrift = checkRuntimeToolSchema();
  if (runtimeDrift) failures.push(runtimeDrift);

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

function resolveAgentPython() {
  const envBin = process.env.AGENT_PYTHON_BIN;
  if (envBin && fs.existsSync(envBin)) return envBin;
  const candidates = [
    path.join(root, 'agent', 'venv', 'Scripts', 'python.exe'),
    path.join(root, 'agent', 'venv', 'bin', 'python'),
    path.join(root, 'agent', '.venv', 'Scripts', 'python.exe'),
    path.join(root, 'agent', '.venv', 'bin', 'python'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function checkRuntimeToolSchema() {
  const python = resolveAgentPython();
  if (!python) {
    console.warn(
      'Runtime tool-schema drift check skipped: no agent Python found. '
      + 'Set AGENT_PYTHON_BIN to enforce in CI.',
    );
    return null;
  }
  const pythonCode = [
    'import json',
    'from app.core.contracts.operations import RoadmapOperation',
    'from app.core.tools.registry import get_planning_tool',
    'out = {',
    '    "pydantic_fields": list(RoadmapOperation.model_json_schema()["properties"].keys()),',
    '    "tool": get_planning_tool(),',
    '}',
    'print(json.dumps(out))',
  ].join('\n');
  const result = spawnSync(python, ['-c', pythonCode], {
    cwd: path.join(root, 'agent'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return `runtime_tool_schema: python probe failed (status=${result.status}) stderr=${result.stderr?.slice(0, 400)}`;
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (err) {
    return `runtime_tool_schema: unparseable python output: ${err.message}`;
  }
  const pydanticFields = new Set(payload.pydantic_fields ?? []);
  const branches =
    payload.tool?.function?.parameters?.properties?.operations?.items?.anyOf ?? [];
  if (!Array.isArray(branches) || branches.length === 0) {
    return 'runtime_tool_schema: no anyOf branches found in plan_roadmap_operations';
  }
  for (const branch of branches) {
    const op = branch?.properties?.op?.const ?? '?';
    const branchFields = new Set(Object.keys(branch?.properties ?? {}));
    const missing = [...pydanticFields].filter((f) => !branchFields.has(f));
    if (missing.length > 0) {
      return `runtime_tool_schema: op=${op} branch missing fields ${JSON.stringify(missing)}`;
    }
    const extra = [...branchFields].filter((f) => !pydanticFields.has(f));
    if (extra.length > 0) {
      return `runtime_tool_schema: op=${op} branch has extra fields ${JSON.stringify(extra)}`;
    }
  }
  return null;
}

function findStrictModeViolation(canonicalSchema) {
  const item = canonicalSchema?.properties?.operations?.items;
  if (!item || typeof item !== 'object') return null;
  const forbidden = ['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else'];
  for (const key of forbidden) {
    if (key in item) {
      return `operations.items contains "${key}" — not permitted in strict-mode schema`;
    }
  }
  const itemProps = item.properties ?? {};
  for (const [propName, propSchema] of Object.entries(itemProps)) {
    if (!propSchema || typeof propSchema !== 'object') continue;
    for (const key of forbidden) {
      if (key in propSchema) {
        return `operations.items.properties.${propName} contains "${key}"`;
      }
    }
  }
  return null;
}

function extractRegistryToolRequiredArgs(content, toolName) {
  // The registry was refactored to use a `_function_tool(...)` helper with
  // keyword arguments rather than inline dict literals. Match the
  // `name='<toolName>'` entry and then walk forward to its sibling
  // `required=[...]` within the same call. Sibling safety is fine because
  // `required=` only appears once per `_function_tool(...)` invocation and
  // always comes after `name=`.
  const nameEscaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePattern = new RegExp(
    `name=['"]${nameEscaped}['"][\\s\\S]*?required=\\[([^\\]]*)\\]`,
    'm',
  );
  const match = content.match(namePattern);
  if (!match) {
    throw new Error(`Could not find tool definition in registry: ${toolName}`);
  }
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

main();
