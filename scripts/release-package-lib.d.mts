export interface ReleaseFile { path: string; bytes: number; sha256: string }
export interface ReleaseManifest { formatVersion: 1; application: string; version: string; createdAt: string; sourceCommit: string | null; sourceTreeDirty: boolean | null; files: ReleaseFile[] }
export function packRelease(options: { root?: string; destination: string }): Promise<ReleaseManifest>;
export function verifyRelease(root: string): Promise<{ verified: true; version: string; files: number; sourceCommit: string | null; sourceTreeDirty: boolean | null; signed: false }>;
