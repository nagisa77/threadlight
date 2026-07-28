---
name: skill-creator
description: Create or update a focused reusable Agent Skill in the current project or user profile. Use when the user asks to create, author, scaffold, package, or improve a skill; turn a repeated workflow into reusable instructions; or design a dedicated reusable agent, teacher, coach, or expert (for example, “制作一个专门的老师 Agent”). Do not trigger only because “skill” means a human ability to learn or when the user asks to implement an agent application in code.
---

# Create a skill

Create one focused skill for another agent to follow.

1. Understand the workflow from concrete requests that should trigger it. Treat a dedicated agent, teacher, coach, or expert with reusable operating instructions as a skill request even when the user does not use the term Agent Skill. Do not treat a one-off role-play or executable agent application as a skill request. Ask one concise question only when the missing answer would materially change the skill.
2. Choose `project` scope for repository-specific workflows and `user` scope only when the user wants the skill across repositories.
3. Prefer an instruction-only skill. Include only non-obvious procedural knowledge, required inputs, ordered steps, expected output, safety boundaries, and stopping conditions.
4. Write a concise description that states both what the skill does and when it should trigger. The description is the activation mechanism.
5. Use lowercase hyphen-case for the name. Keep the instructions imperative and avoid auxiliary README, changelog, or installation documents.
6. Call `skill_create` with the final scope, name, description, and instructions.
7. Report the created `SKILL.md` path and tell the user that a new task will discover it.

Do not create scripts, references, or assets unless the user explicitly needs them; the current creator intentionally produces validated instruction-only skills.
