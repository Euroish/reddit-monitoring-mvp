import type { SavedWorkbenchView } from "../../../domain/entities/saved-workbench-view";
import type { SavedWorkbenchViewRepository } from "../../../domain/repositories/saved-workbench-view-repository";

export class InMemorySavedWorkbenchViewRepository implements SavedWorkbenchViewRepository {
  private readonly viewsById = new Map<string, SavedWorkbenchView>();

  public async upsert(view: SavedWorkbenchView): Promise<SavedWorkbenchView> {
    this.viewsById.set(view.id, {
      ...view,
      compareTargets: [...view.compareTargets],
      keywords: [...view.keywords],
      seriesIds: [...view.seriesIds],
    });
    return view;
  }

  public async listByUser(args: {
    userId: string;
    limit: number;
  }): Promise<SavedWorkbenchView[]> {
    return Array.from(this.viewsById.values())
      .filter((view) => view.userId === args.userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, args.limit)
      .map((view) => ({
        ...view,
        compareTargets: [...view.compareTargets],
        keywords: [...view.keywords],
        seriesIds: [...view.seriesIds],
      }));
  }
}
