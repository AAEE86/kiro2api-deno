// Authentication configuration types
export interface AuthConfig {
  auth: "Social" | "IdC";
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
  disabled?: boolean;
  description?: string;
}

// Load authentication configurations from environment
export async function loadAuthConfigs(): Promise<AuthConfig[]> {
  const authToken = Deno.env.get("KIRO_AUTH_TOKEN");

  if (!authToken) {
    throw new Error("KIRO_AUTH_TOKEN environment variable not set");
  }

  // Check if it's a file path
  try {
    const stat = await Deno.stat(authToken);
    if (stat.isFile) {
      const content = await Deno.readTextFile(authToken);
      return parseAuthConfigs(content);
    }
  } catch {
    // Not a file, treat as JSON string
  }

  // Parse as JSON string
  return parseAuthConfigs(authToken);
}

function parseAuthConfigs(jsonString: string): AuthConfig[] {
  try {
    const configs = JSON.parse(jsonString) as AuthConfig[];

    if (!Array.isArray(configs)) {
      throw new Error("KIRO_AUTH_TOKEN must be a JSON array");
    }

    // Filter out disabled configs
    const enabledConfigs = configs.filter((c) => !c.disabled);

    if (enabledConfigs.length === 0) {
      throw new Error("No enabled authentication configs found");
    }

    // Validate configs
    for (const config of enabledConfigs) {
      if (!config.auth || !config.refreshToken) {
        throw new Error("Invalid auth config: missing auth or refreshToken");
      }

      if (config.auth === "IdC") {
        if (!config.clientId || !config.clientSecret) {
          throw new Error("IdC auth requires clientId and clientSecret");
        }
      }
    }

    return enabledConfigs;
  } catch (error) {
    throw new Error(`Failed to parse auth configs: ${error.message}`);
  }
}
