BEGIN;

DELETE FROM feed_user_event AS e
USING (
  SELECT user_id, content_id, event_type, min(id) AS first_id
  FROM feed_user_event WHERE event_type IN ('bookmark', 'useful')
  GROUP BY user_id, content_id, event_type
  HAVING count(*) > 1
) AS duplicate
WHERE e.user_id = duplicate.user_id AND e.content_id = duplicate.content_id
  AND e.event_type = duplicate.event_type AND e.id <> duplicate.first_id;

-- This V2 table is created in 060. The migration runner applies schema changes in a transaction.
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX uq_feed_user_positive_event ON feed_user_event (user_id, content_id, event_type)
  WHERE event_type IN ('bookmark', 'useful');

COMMIT;
