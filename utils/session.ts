export class SessionManager {
  private static sessions = new Map<string, string>();

  static generateStableConversationId(clientInfo: {
    ip?: string;
    userAgent?: string;
    customId?: string;
  }): string {
    const key = `${clientInfo.ip || "unknown"}_${clientInfo.userAgent || "unknown"}_${clientInfo.customId || ""}`;
    
    if (this.sessions.has(key)) {
      return this.sessions.get(key)!;
    }

    const conversationId = crypto.randomUUID();
    this.sessions.set(key, conversationId);
    
    // Clean up old sessions (keep last 1000)
    if (this.sessions.size > 1000) {
      const entries = Array.from(this.sessions.entries());
      this.sessions.clear();
      entries.slice(-500).forEach(([k, v]) => this.sessions.set(k, v));
    }

    return conversationId;
  }

  static generateAgentContinuationId(): string {
    return crypto.randomUUID();
  }

  static extractClientInfo(req: Request): {
    ip?: string;
    userAgent?: string;
    customId?: string;
  } {
    const headers = req.headers;
    return {
      ip: headers.get("x-forwarded-for") || headers.get("x-real-ip") || "unknown",
      userAgent: headers.get("user-agent") || "unknown",
      customId: headers.get("x-conversation-id") || undefined,
    };
  }
}