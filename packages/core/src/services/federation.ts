import { workspaceConfigService } from './workspace-config.js';
import type { SearchResult } from './intelligence.js';

export interface FederatedSearchResult extends SearchResult {
  workspaceOrigin: string;
}

export class FederationService {
  private getPeers(): string[] {
    const raw = workspaceConfigService.get('federation.peers');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Fans out search to all configured peer workspaces.
   * Merges and re-ranks by score, deduplicates by path+origin.
   */
  async search(query: string, options: { limit?: number; offset?: number } = {}): Promise<FederatedSearchResult[]> {
    const peers = this.getPeers();
    if (peers.length === 0) return [];

    const results = await Promise.allSettled(
      peers.map(peer => this.searchPeer(peer, query, options))
    );

    const all: FederatedSearchResult[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const item of result.value) {
          const key = `${item.workspaceOrigin}:${item.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            all.push(item);
          }
        }
      }
    }

    return all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  private async searchPeer(peerUrl: string, query: string, options: { limit?: number; offset?: number }): Promise<FederatedSearchResult[]> {
    const url = new URL('/api/search', peerUrl);
    url.searchParams.set('q', query);
    if (options.limit) url.searchParams.set('limit', String(options.limit));
    if (options.offset) url.searchParams.set('offset', String(options.offset));

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Peer ${peerUrl} returned ${response.status}`);

    const data: SearchResult[] = await response.json();
    return data.map(item => ({ ...item, workspaceOrigin: peerUrl }));
  }

  public addPeer(url: string): void {
    const peers = this.getPeers();
    if (!peers.includes(url)) {
      workspaceConfigService.set('federation.peers', JSON.stringify([...peers, url]));
    }
  }

  public removePeer(url: string): void {
    const peers = this.getPeers().filter(p => p !== url);
    workspaceConfigService.set('federation.peers', JSON.stringify(peers));
  }

  public listPeers(): string[] {
    return this.getPeers();
  }
}

/** @deprecated Use container.resolve(TOKENS.Federation) from createContextOS() instead. */
export const federationService = new FederationService();
