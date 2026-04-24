import type { ISODateTime, UUID } from "../../shared/types/common";
import type { WorkbenchComparableSeriesId } from "../../../packages/contracts/src/http";

export type SavedWorkbenchViewKind = "target" | "comparison";

export interface SavedWorkbenchView {
  id: UUID;
  userId: UUID;
  name: string;
  viewKind: SavedWorkbenchViewKind;
  primaryTarget: string;
  compareTargets: string[];
  keywords: string[];
  seriesIds: WorkbenchComparableSeriesId[];
  routePath: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
