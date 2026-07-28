import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { defineTool, type Tool } from "@threadlight/agent-loop";

import { validateSkillName } from "./skill-registry.js";

const MAX_DESCRIPTION_CHARS = 2_048;
const MAX_INSTRUCTIONS_CHARS = 50_000;

export interface SkillCreatorRoots {
  project: string;
  user: string;
}

export interface SkillCreateInput {
  scope: keyof SkillCreatorRoots;
  name: string;
  description: string;
  instructions: string;
}

export interface SkillCreateResult {
  name: string;
  scope: keyof SkillCreatorRoots;
  path: string;
  skillFile: string;
  created: true;
  note: string;
}

export function createSkillCreateTool(roots: SkillCreatorRoots): Tool {
  const normalizedRoots = {
    project: resolve(roots.project),
    user: resolve(roots.user),
  };
  return defineTool({
    name: "skill_create",
    description:
      "Create one validated instruction-only Agent Skill in the project or user skill directory. Use only after loading $skill-creator when the user asks for a skill, a reusable workflow, or a dedicated reusable agent, teacher, coach, or expert.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["project", "user"],
          description:
            "project stores the skill in this repository; user makes it available across repositories.",
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description:
            "Lowercase hyphen-case skill name, for example release-check.",
        },
        description: {
          type: "string",
          minLength: 1,
          maxLength: MAX_DESCRIPTION_CHARS,
          description:
            "What the skill does and the concrete situations that should trigger it.",
        },
        instructions: {
          type: "string",
          minLength: 1,
          maxLength: MAX_INSTRUCTIONS_CHARS,
          description:
            "Concise imperative workflow instructions for another agent to follow.",
        },
      },
      required: ["scope", "name", "description", "instructions"],
      additionalProperties: false,
    },
    execute(arguments_) {
      return createSkill(normalizedRoots, parseSkillCreateInput(arguments_));
    },
  });
}

export async function createSkill(
  roots: SkillCreatorRoots,
  input: SkillCreateInput,
): Promise<SkillCreateResult> {
  validateSkillName(input.name);
  const description = requireBoundedText(
    input.description,
    "description",
    MAX_DESCRIPTION_CHARS,
  );
  const instructions = requireBoundedText(
    input.instructions,
    "instructions",
    MAX_INSTRUCTIONS_CHARS,
  );
  const root = resolve(roots[input.scope]);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = join(root, input.name);
  const temporary = await mkdtemp(join(root, `.${input.name}-`));
  try {
    const agentsDirectory = join(temporary, "agents");
    await mkdir(agentsDirectory, { mode: 0o700 });
    await writeFile(
      join(temporary, "SKILL.md"),
      [
        "---",
        `name: ${input.name}`,
        `description: ${JSON.stringify(description)}`,
        "---",
        "",
        instructions,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      join(agentsDirectory, "openai.yaml"),
      [
        "interface:",
        `  display_name: ${JSON.stringify(displayName(input.name))}`,
        `  short_description: ${JSON.stringify(description.slice(0, 120))}`,
        `  default_prompt: ${JSON.stringify(`Use $${input.name} for this task.`)}`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (
      isNodeError(error) &&
      (error.code === "EEXIST" || error.code === "ENOTEMPTY")
    ) {
      throw new Error(`Skill already exists: ${input.name}`);
    }
    throw error;
  }

  return {
    name: input.name,
    scope: input.scope,
    path: target,
    skillFile: join(target, "SKILL.md"),
    created: true,
    note:
      "The current task keeps its original skill snapshot. Start a new task to discover this skill.",
  };
}

function parseSkillCreateInput(value: unknown): SkillCreateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("skill_create arguments must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.scope !== "project" && input.scope !== "user") {
    throw new Error("scope must be project or user");
  }
  if (
    typeof input.name !== "string" ||
    typeof input.description !== "string" ||
    typeof input.instructions !== "string"
  ) {
    throw new Error(
      "name, description, and instructions must be strings",
    );
  }
  return {
    scope: input.scope,
    name: input.name.trim(),
    description: input.description,
    instructions: input.instructions,
  };
}

function requireBoundedText(
  value: string,
  field: string,
  maxChars: number,
): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  if (normalized.length > maxChars) {
    throw new Error(`${field} exceeds ${maxChars} characters`);
  }
  return normalized;
}

function displayName(name: string): string {
  return name
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
