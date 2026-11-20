BEGIN;

-- 1. Verify legacy tables hold zero unexpected user/content rows before removal.
DO $$
DECLARE
  tbl TEXT;
  cnt BIGINT;
  retired TEXT[] := ARRAY[
    'subreddit_trend_point', 'subreddit_trend_point_experiment', 'subreddit_daily_fact',
    'subreddit_collection_coverage', 'keyword_pulse_point_5m', 'keyword_query_result_summary',
    'keyword_query_sample_post', 'keyword_query_session', 'keyword_trend_daily',
    'post_growth_fact', 'post_engagement_latest', 'post_engagement_window',
    'post_search_document', 'metrics_snapshot', 'anomaly_event',
    'reddit_fetch_event', 'raw_reddit_event', 'provider_health_window',
    'crawl_cursor', 'collection_job', 'monitor_target', 'account',
    'research_export_member', 'research_export', 'saved_workbench_view', 'runtime_setting'
  ];
BEGIN
  FOREACH tbl IN ARRAY retired LOOP
    IF to_regclass('public.' || quote_ident(tbl)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', tbl) INTO cnt;
      IF cnt > 0 THEN
        RAISE EXCEPTION 'Refusing to drop non-empty legacy table % (% rows)', tbl, cnt;
      END IF;
    END IF;
  END LOOP;
END $$;

-- 2. Detach legacy constraints/indexes from active tables, then drop 27 retired tables.
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_account_id_fkey;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_first_collection_job_id_fkey;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_target_id_fkey;
DROP INDEX IF EXISTS idx_content_target_total_eligible_created;
DROP INDEX IF EXISTS idx_content_target_created_at_source_desc;

DROP TABLE IF EXISTS
  subreddit_trend_point,
  subreddit_trend_point_experiment,
  subreddit_daily_fact,
  subreddit_collection_coverage,
  keyword_pulse_point_5m,
  keyword_query_result_summary,
  keyword_query_sample_post,
  keyword_query_session,
  keyword_trend_daily,
  post_growth_fact,
  post_engagement_latest,
  post_engagement_window,
  post_search_document,
  metrics_snapshot,
  anomaly_event,
  reddit_fetch_event,
  raw_reddit_event,
  provider_health_window,
  crawl_cursor,
  collection_job,
  monitor_target,
  account,
  research_export_member,
  research_export,
  saved_workbench_view,
  runtime_setting,
  source_dispatch_state
CASCADE;

DROP SEQUENCE IF EXISTS metrics_snapshot_id_seq, raw_reddit_event_id_seq, reddit_fetch_event_id_seq;

-- 3. Drop dead legacy columns from active tables.
ALTER TABLE content
  DROP COLUMN IF EXISTS target_id,
  DROP COLUMN IF EXISTS account_id,
  DROP COLUMN IF EXISTS discovery_source,
  DROP COLUMN IF EXISTS first_collection_mode,
  DROP COLUMN IF EXISTS first_listing,
  DROP COLUMN IF EXISTS first_time_range,
  DROP COLUMN IF EXISTS first_collection_job_id,
  DROP COLUMN IF EXISTS total_eligible;

ALTER TABLE public_content_search_document
  DROP COLUMN IF EXISTS normalized_title,
  DROP COLUMN IF EXISTS normalized_text;

ALTER TABLE collection_source
  DROP CONSTRAINT IF EXISTS collection_source_platform_id_provider_content_kind_target_key;
DROP INDEX IF EXISTS collection_source_platform_id_provider_content_kind_target_key;
ALTER TABLE collection_source
  ADD CONSTRAINT uq_collection_source_identity UNIQUE (platform_id, primary_provider, content_kind, target);

ALTER TABLE collection_source
  DROP COLUMN IF EXISTS provider,
  DROP COLUMN IF EXISTS refresh,
  DROP COLUMN IF EXISTS next_recheck_at;

-- 4. Upgrade collection_source metadata, health observability, and HTTP conditional cache columns.
ALTER TABLE collection_source
  ADD CONSTRAINT collection_source_group_check
  CHECK (source_group IS NULL OR source_group ~ '^[a-z0-9][a-z0-9_-]{0,47}$');

CREATE INDEX idx_collection_source_group ON collection_source(source_group) WHERE state = 'active';

ALTER TABLE collection_source
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN locale TEXT CHECK (locale IS NULL OR locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  ADD COLUMN fetch_policy JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fetch_policy) = 'object'),
  ADD COLUMN health JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(health) = 'object');

-- Backfill HTTP cache validators onto collection_source from the latest succeeded job checkpoint.
UPDATE collection_source cs SET
  http_etag = COALESCE(cs.http_etag, NULLIF(latest.checkpoint->>'etag', '')),
  http_last_modified = COALESCE(cs.http_last_modified, NULLIF(latest.checkpoint->>'modified', ''))
FROM (
  SELECT DISTINCT ON (collection_source_id) collection_source_id, checkpoint
  FROM source_collection_job
  WHERE provider = 'feed' AND status = 'succeeded' AND checkpoint IS NOT NULL
  ORDER BY collection_source_id, finished_at DESC NULLS LAST, created_at DESC
) latest
WHERE cs.id = latest.collection_source_id;

-- Backfill source_group and locale deterministically for existing active sources.
UPDATE collection_source SET
  source_group = COALESCE(source_group, CASE
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(openai\.com|github\.com/openai/|anthropic|deepmind|huggingface|qwen|nvidia\.com.*generative-ai|aws\.amazon\.com/blogs/machine-learning|microsoft\.com/.*/research|latent\.space|simonwillison|arxiv\.org)' THEN 'ai-firsthand'
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(cloudflare|rust-lang|debian|djangoproject|github\.blog|go\.dev|kubernetes|netflixtechblog|postgresql|stackoverflow|w3\.org|cisa\.gov|planetpython|schneier|infoq|hnrss|hackernews)' THEN 'dev-infra'
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(404media|arstechnica|techcrunch|theverge|bbci\.co\.uk/news/technology|cnbeta|ithome|technews\.tw|ifanr|v2ex|UCXuqSBlHAE6Xw-yeJA0Tunw|UCBJycsmduvYEL83R_U4JriQ)' THEN 'tech-media'
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(shoppingdesign|spoon-tamago|thisiscolossal|creativeboom|densediscovery|publicdomainreview|designboom|UCpYHEAhSUx1hBn2SkvXvTrg|UC_zQ777U6YTyatP3P1wi3xw)' THEN 'design-visual'
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(budgetbytes|justonecookbook|thekitchn|atlasobscura|lifeandstyle|crossing\.cw|changhai|lowtechmagazine|reasonstobecheerful|kottke|boingboing|themarginalian|aeon\.co|UC54SLBnD5k5U3Q6N__UjbAw|UCajXeitgFL-rb5-gXI-aG8Q)' THEN 'lifestyle'
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(nasa\.gov|earthquake\.usgs|ourworldindata|nature\.com|science\.org|quantamagazine|smithsonianmag|pansci\.asia|science_and_environment|UCYO_jab_esuFRV4b17AJtAw|UCHnyfMqiRRG1u-2MsSQLbXA)' THEN 'science'
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(ecb\.europa|federalreserve|eff\.org|who\.int|news\.un\.org|bbci\.co\.uk|theguardian\.com/world|npr\.org|propublica|theconversation|theinitium|twreporter|rss\.dw\.com)' THEN 'public-affairs'
    ELSE 'social-trends'
  END),
  locale = COALESCE(locale, CASE
    WHEN COALESCE(target->>'url', target->>'query', '') ~* '(bilibili|zhihu|ithome|ifanr|cnbeta|v2ex|technews\.tw|pansci|shoppingdesign|theinitium|twreporter|crossing\.cw|blow\.streetvoice|changhai|news\.un\.org/feed/subscribe/zh|rss-chi)' THEN 'zh'
    ELSE 'en'
  END)
WHERE state = 'active';

-- Unblock stuck high-frequency feed intervals (< 900s) and lift feed global mutex bottleneck.
UPDATE collection_source
SET
  schedule = schedule || jsonb_build_object(
    'intervalSeconds', GREATEST(COALESCE((schedule->>'cadenceSeconds')::int, 3600), 1800)
  ),
  next_due_at = LEAST(COALESCE(next_due_at, now()), now()),
  updated_at = now()
WHERE primary_provider = 'feed'
  AND state = 'active'
  AND COALESCE((schedule->>'intervalSeconds')::int, 3600) < 900;

UPDATE source_provider_budget
SET
  minimum_interval_ms = 0,
  daily_requests = GREATEST(daily_requests, 20000),
  monthly_requests = GREATEST(monthly_requests, 620000),
  daily_resources = GREATEST(daily_resources, 600000),
  monthly_resources = GREATEST(monthly_resources, 18600000),
  revision = revision + 1
WHERE provider = 'feed';

-- 5. Backfill content.language, web channel metadata, and trim search_text bloat.
UPDATE content SET
  language = CASE
    WHEN COALESCE(title, '') || ' ' || left(COALESCE(body_text, ''), 400) ~ U&'[\3040-\30FF]' THEN 'ja'
    WHEN COALESCE(title, '') || ' ' || left(COALESCE(body_text, ''), 400) ~ U&'[\AC00-\D7AF]' THEN 'ko'
    WHEN COALESCE(title, '') || ' ' || left(COALESCE(body_text, ''), 400) ~ U&'[\4E00-\9FFF]' THEN 'zh'
    WHEN COALESCE(title, '') || ' ' || left(COALESCE(body_text, ''), 400) ~ '[a-zA-Z]{3,}' THEN 'en'
    ELSE NULL
  END
WHERE language IS NULL;

CREATE INDEX idx_content_language ON content(language) WHERE language IS NOT NULL;

UPDATE content c SET
  platform_details = jsonb_set(
    c.platform_details,
    '{channel}',
    to_jsonb(CASE
      WHEN c.platform_details->>'publisher' IN ('www.youtube.com', 'youtube.com', 'youtu.be') THEN 'youtube'
      WHEN c.platform_details->>'publisher' LIKE '%bilibili.com%' THEN 'bilibili'
      WHEN c.platform_details->>'publisher' LIKE '%zhihu.com%' THEN 'zhihu'
      WHEN c.platform_details->>'publisher' LIKE 'trends.google.com%' THEN 'google-trends'
      WHEN c.platform_details->>'publisher' IN ('github.com', 'github.blog') THEN 'github'
      WHEN c.platform_details->>'publisher' LIKE '%ycombinator.com%' THEN 'hackernews'
      WHEN c.platform_details->>'publisher' LIKE '%arxiv.org%' THEN 'arxiv'
      WHEN c.platform_details->>'publisher' LIKE '%huggingface.co%' THEN 'huggingface'
      ELSE 'rss'
    END),
    true
  )
FROM source p
WHERE p.id = c.source_id AND p.code = 'web' AND NOT (c.platform_details ? 'channel');

UPDATE public_content_search_document
SET search_text = left(search_text, title_length + 1 + 1500)
WHERE char_length(search_text) > title_length + 1 + 1500;

DROP INDEX IF EXISTS idx_content_search_trgm;
DROP INDEX IF EXISTS idx_content_search_bigram;
CREATE INDEX idx_content_search_trgm ON public_content_search_document USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_content_search_bigram ON public_content_search_document USING gin (public_search_bigrams(search_text));

CREATE INDEX idx_source_collection_job_cleanup
  ON source_collection_job(finished_at)
  WHERE status IN ('succeeded', 'failed', 'cancelled');

COMMIT;
