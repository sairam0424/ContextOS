import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Manages resource subscriptions per session.
 * Clients can subscribe to resource URIs to receive update notifications.
 */
export class SubscriptionManager {
  private subscriptions = new Map<string, Set<string>>(); // uri -> Set<sessionId>
  private serverRef: McpServer | null = null;

  setServer(server: McpServer): void {
    this.serverRef = server;
  }

  subscribe(uri: string, sessionId: string): void {
    let sessions = this.subscriptions.get(uri);
    if (!sessions) {
      sessions = new Set();
      this.subscriptions.set(uri, sessions);
    }
    sessions.add(sessionId);
  }

  unsubscribe(uri: string, sessionId: string): void {
    const sessions = this.subscriptions.get(uri);
    if (!sessions) return;
    sessions.delete(sessionId);
    if (sessions.size === 0) {
      this.subscriptions.delete(uri);
    }
  }

  cleanup(sessionId: string): void {
    for (const [uri, sessions] of this.subscriptions) {
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        this.subscriptions.delete(uri);
      }
    }
  }

  notifyResourceUpdated(uri: string): void {
    if (!this.serverRef) return;
    const sessions = this.subscriptions.get(uri);
    if (!sessions || sessions.size === 0) return;
    try {
      this.serverRef.server.sendResourceUpdated({ uri });
    } catch {
      /* client may not support resource subscriptions */
    }
  }

  getSubscriberCount(uri: string): number {
    return this.subscriptions.get(uri)?.size ?? 0;
  }
}

export const subscriptionManager = new SubscriptionManager();
