// Usage statistics structure
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // Anthropic format compatibility
  input_tokens?: number;
  output_tokens?: number;
}

// Token management
export interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  expiresIn?: number;
  profileArn?: string;
}

export interface TokenWithUsage {
  tokenInfo: TokenInfo;
  configIndex: number;
  remainingRequests?: number;
  totalRequests?: number;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  profileArn?: string;
  tokenType?: string;
}

// Image source structure
export interface ImageSource {
  type: string;
  media_type: string;
  data: string;
}

// Content block structure
export interface ContentBlock {
  type: string;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  name?: string;
  input?: unknown;
  id?: string;
  is_error?: boolean;
  source?: ImageSource;
}

// Model information
export interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  display_name?: string;
  type?: string;
  max_tokens?: number;
}

export interface ModelsResponse {
  object: string;
  data: Model[];
}

export interface UsageLimits {
  totalLimit: number;
  currentUsage: number;
  remainingUsage: number;
  isExceeded: boolean;
  resetDate: Date | null;
}

export interface ToolExecution {
  id: string;
  name: string;
  input: any;
  output?: any;
  status: "running" | "completed" | "error";
  error?: string;
}
