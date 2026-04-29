BEGIN;

ALTER TABLE content
  DROP CONSTRAINT IF EXISTS ck_content_discovery_source;

ALTER TABLE content
  ADD CONSTRAINT ck_content_discovery_source
    CHECK (
      discovery_source IN (
        'new_listing',
        'hot_listing',
        'best_listing',
        'rising_listing',
        'top_supplement',
        'unknown'
      )
    );

ALTER TABLE content
  DROP CONSTRAINT IF EXISTS ck_content_first_listing;

ALTER TABLE content
  ADD CONSTRAINT ck_content_first_listing
    CHECK (
      first_listing IS NULL
      OR first_listing IN ('new', 'hot', 'best', 'rising', 'top', 'unknown')
    );

COMMIT;
