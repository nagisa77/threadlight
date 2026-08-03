export interface HostArgs {
  host?: string;
  port?: number;
  home?: string;
  project?: string;
  token?: string;
  origins: string[];
  name?: string;
  publicUrl?: string;
}

export function parseHostArgs(values: string[]): HostArgs {
  const result: HostArgs = { origins: [] };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      flag !== "--host" &&
      flag !== "--port" &&
      flag !== "--home" &&
      flag !== "--project" &&
      flag !== "--token" &&
      flag !== "--origin" &&
      flag !== "--name" &&
      flag !== "--public-url"
    ) {
      throw new Error(`Unknown Threadlight Host option: ${flag}`);
    }
    if (!value) throw new Error(`Missing value for ${flag}`);
    index += 1;
    if (flag === "--host") result.host = value;
    if (flag === "--home") result.home = value;
    if (flag === "--project") result.project = value;
    if (flag === "--token") result.token = value;
    if (flag === "--origin") result.origins.push(value);
    if (flag === "--name") result.name = value;
    if (flag === "--public-url") result.publicUrl = value;
    if (flag === "--port") {
      const port = Number.parseInt(value, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error(`Invalid port: ${value}`);
      }
      result.port = port;
    }
  }
  return result;
}
