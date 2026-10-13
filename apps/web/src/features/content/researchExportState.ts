import type { ResearchExportPageResponse } from '../../../../../packages/contracts/src/research-export.js';
import { getAuthEpoch } from '../../api/client.js';

export function researchPageParams(limit: number, cursor?: string): string {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Frozen pages require a limit of 1–100.');
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

export function validateResearchPage(page: ResearchExportPageResponse, id: string, total: number, limit: number): void {
  if (page.exportId !== id || page.total !== total || page.manifest.total !== total || page.scope !== 'frozen_members' || page.items.length > Math.min(limit, total) || page.nextCursor && page.items.length === 0) throw new Error('Frozen page metadata does not match this snapshot. Refresh before downloading.');
}

export function researchCsvMetadata(headers: Headers, total: number, limit: number): { count: number; nextCursor: string | null } {
  const count = headers.get('X-Export-Count'), denominator = headers.get('X-Export-Total-Matching');
  const nextCursor = headers.get('X-Export-Next-Cursor') || null;
  if (count === null || denominator === null || !/^\d+$/u.test(count) || !/^\d+$/u.test(denominator) || Number(denominator) !== total || Number(count) > Math.min(limit, total) || headers.get('X-Export-Scope') !== 'frozen_members' || Number(count) === 0 && nextCursor) throw new Error('CSV metadata does not match this frozen snapshot. Refresh before downloading.');
  return { count: Number(count), nextCursor };
}

export function downloadResearchBlob(blob: Blob, filename: string, expectedEpoch = getAuthEpoch()): boolean {
  if (expectedEpoch !== getAuthEpoch()) return false;
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
