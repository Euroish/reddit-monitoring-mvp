import type { SavedWorkbenchView } from "../entities/saved-workbench-view";

export interface SavedWorkbenchViewRepository {
  upsert(view: SavedWorkbenchView): Promise<SavedWorkbenchView>;
  listByUser(args: {
    userId: string;
    limit: number;
  }): Promise<SavedWorkbenchView[]>;
}
