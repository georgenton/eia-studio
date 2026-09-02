/**
 * S3-compatible object storage boundary (SECURITY.md §7). Keys are always tenant/project
 * prefixed and only presigned URLs leave the server. No adapter is configured in Slice 0.
 */
export interface StorageKey {
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly module: string;
  readonly objectId: string;
  readonly filename: string;
}

export function formatStorageKey(key: StorageKey): string {
  const project = key.projectId ? `p/${key.projectId}/` : "";
  return `t/${key.tenantId}/${project}${key.module}/${key.objectId}/${key.filename}`;
}

export interface StoragePort {
  presignUpload(key: StorageKey, contentType: string, ttlSeconds: number): Promise<string>;
  presignDownload(key: StorageKey, ttlSeconds: number): Promise<string>;
}
