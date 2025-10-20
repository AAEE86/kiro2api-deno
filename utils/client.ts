import { getEnvWithDefault } from "./env.ts";

export function shouldSkipTLSVerify(): boolean {
  return getEnvWithDefault("GIN_MODE", "") === "debug";
}

export function createHTTPClient(): Deno.HttpClient | undefined {
  const skipTLS = shouldSkipTLSVerify();
  
  if (skipTLS) {
    console.warn("[WARNING] TLS证书验证已禁用 - 仅适用于开发/调试环境");
    return Deno.createHttpClient({
      // @ts-ignore: Deno specific option
      caCerts: [],
    });
  }
  
  return undefined;
}

export const sharedHTTPClient = createHTTPClient();

export function doRequest(url: string | URL, init?: RequestInit): Promise<Response> {
  if (sharedHTTPClient) {
    return fetch(url, { ...init, client: sharedHTTPClient });
  }
  return fetch(url, init);
}
