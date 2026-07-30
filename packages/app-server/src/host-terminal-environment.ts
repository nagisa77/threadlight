const HOST_ONLY_ENVIRONMENT_KEYS = ["THREADLIGHT_HOST_TOKEN"] as const;

export function hostTerminalEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const key of HOST_ONLY_ENVIRONMENT_KEYS) delete sanitized[key];
  return sanitized;
}
