import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface ExecutionPolicyGrant {
  permissionKey: string;
  label: string;
  external: boolean;
  grantedAt: string;
}

export interface ExecutionPolicySnapshot {
  projectId: string;
  rules: {
    read: "allow";
    write: "ask";
    destructive: "deny";
  };
  permanentGrants: readonly ExecutionPolicyGrant[];
}

interface StoredPolicyFile {
  version: 1;
  projects: Record<string, { grants: ExecutionPolicyGrant[] }>;
}

const EMPTY_POLICY: StoredPolicyFile = { version: 1, projects: {} };

export class ExecutionPolicyStore {
  private state: StoredPolicyFile;

  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.state = this.read();
  }

  snapshot(projectId: string): ExecutionPolicySnapshot {
    return {
      projectId,
      rules: {
        read: "allow",
        write: "ask",
        destructive: "deny",
      },
      permanentGrants: [...(this.state.projects[projectId]?.grants ?? [])].sort(
        (a, b) => a.label.localeCompare(b.label),
      ),
    };
  }

  allows(projectId: string, permissionKey: string): boolean {
    return (
      this.state.projects[projectId]?.grants.some(
        (grant) => grant.permissionKey === permissionKey,
      ) ?? false
    );
  }

  grant(
    projectId: string,
    input: Pick<ExecutionPolicyGrant, "permissionKey" | "label" | "external">,
  ): ExecutionPolicySnapshot {
    const existing = this.state.projects[projectId]?.grants ?? [];
    const grant: ExecutionPolicyGrant = {
      ...input,
      grantedAt: this.now().toISOString(),
    };
    this.state = {
      version: 1,
      projects: {
        ...this.state.projects,
        [projectId]: {
          grants: [
            ...existing.filter(
              (item) => item.permissionKey !== input.permissionKey,
            ),
            grant,
          ],
        },
      },
    };
    this.write();
    return this.snapshot(projectId);
  }

  revoke(projectId: string, permissionKey: string): ExecutionPolicySnapshot {
    const existing = this.state.projects[projectId]?.grants ?? [];
    this.state = {
      version: 1,
      projects: {
        ...this.state.projects,
        [projectId]: {
          grants: existing.filter(
            (grant) => grant.permissionKey !== permissionKey,
          ),
        },
      },
    };
    this.write();
    return this.snapshot(projectId);
  }

  private read(): StoredPolicyFile {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (!isStoredPolicyFile(value)) return EMPTY_POLICY;
      return value;
    } catch {
      return EMPTY_POLICY;
    }
  }

  private write(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.path);
  }
}

function isStoredPolicyFile(value: unknown): value is StoredPolicyFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !candidate.projects ||
    typeof candidate.projects !== "object" ||
    Array.isArray(candidate.projects)
  ) {
    return false;
  }
  return Object.values(candidate.projects).every((project) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      return false;
    }
    const grants = (project as Record<string, unknown>).grants;
    return (
      Array.isArray(grants) &&
      grants.every((grant) => {
        if (!grant || typeof grant !== "object" || Array.isArray(grant)) {
          return false;
        }
        const item = grant as Record<string, unknown>;
        return (
          typeof item.permissionKey === "string" &&
          typeof item.label === "string" &&
          typeof item.external === "boolean" &&
          typeof item.grantedAt === "string"
        );
      })
    );
  });
}
