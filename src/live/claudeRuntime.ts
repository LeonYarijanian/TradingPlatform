/**
 * Minimal typings for the claude.ai page runtime (`window.claude.use`).
 * Only the members this app calls are described; see the platform contract
 * for the full surface. Every capability can be absent — callers get `null`.
 */
export interface McpError {
  code: string;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface CallToolResult {
  payload?: unknown;
  cache?: { storedAt: number; revalidating: boolean };
}

export type WatchEvent = { type: 'data'; result: CallToolResult } | { type: 'error'; error: McpError };

export interface McpApi {
  callTool(server: string, tool: string, input?: unknown, options?: { cache?: false | { staleTime?: number } }): Promise<CallToolResult>;
  watchTool(
    server: string,
    tool: string,
    input: unknown,
    handler: (ev: WatchEvent) => void,
    options?: { refetchInterval?: number; cache?: { staleTime?: number } },
  ): () => void;
}

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DbError {
  code: string;
  message: string;
}

export interface DocRef {
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  onSnapshot(next: (snap: DocSnapshot) => void, error?: (e: DbError) => void): () => void;
}

export interface DbApi {
  doc(path: string): DocRef;
  collection(path: string): {
    doc(id: string): DocRef;
    onSnapshot(next: (snap: { docs: DocSnapshot[] }) => void, error?: (e: DbError) => void): () => void;
  };
}

export interface UserApi {
  isOwner(): Promise<boolean>;
}

export interface PermissionsApi {
  request(names?: readonly string[]): Promise<Record<string, string>>;
}

interface CapabilityMap {
  mcp: McpApi;
  db: DbApi;
  user: UserApi;
  permissions: PermissionsApi;
}

/** Resolves a capability namespace, or null when this view can't run it. */
export async function loadCapability<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null> {
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!claude || typeof claude.use !== 'function') return null;
  try {
    return ((await claude.use(name)) as CapabilityMap[K] | null) ?? null;
  } catch {
    return null;
  }
}

export const isMcpError = (e: unknown): e is McpError => !!e && typeof e === 'object' && typeof (e as McpError).code === 'string';
