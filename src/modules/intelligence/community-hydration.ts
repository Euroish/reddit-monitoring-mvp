import type { Pool } from "pg";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { transaction } from "../../storage/db";
import { enqueueAutomaticCommunityHydration } from "../collection/index";

const AUTO_HYDRATE_RESERVED_ITEMS = 16;

export async function hydrateHotCommunityPost(pool: Pool, providers: ContentProvider[], sourceId: string) {
  await transaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string; daily_item_budget: number; owner_user_id: string }>(
      `SELECT m.id, m.daily_item_budget, m.owner_user_id
       FROM intel_monitor_source ms JOIN intel_monitor m ON m.id=ms.monitor_id
       WHERE ms.collection_source_id=$1 AND m.kind='community_bundle' AND m.enabled
       ORDER BY m.id
       FOR UPDATE OF m`,
      [sourceId],
    );
    for (const monitor of rows) {
      if (await enqueueAutomaticCommunityHydration(client, providers, {
        sourceId,
        monitorId: monitor.id,
        dailyItemBudget: monitor.daily_item_budget,
        ownerUserId: monitor.owner_user_id,
      })) {
        await client.query(
          `INSERT INTO intel_monitor_usage(monitor_id, day, requests, resources_reserved)
           VALUES($1, (NOW() AT TIME ZONE 'UTC')::date, 1, $2)
           ON CONFLICT (monitor_id, day) DO UPDATE SET
             requests=intel_monitor_usage.requests+1,
             resources_reserved=intel_monitor_usage.resources_reserved+$2`,
          [monitor.id, AUTO_HYDRATE_RESERVED_ITEMS],
        );
        break;
      }
    }
  });
}
