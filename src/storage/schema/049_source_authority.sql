BEGIN;
ALTER TABLE collection_source ADD COLUMN tier TEXT NOT NULL DEFAULT 'T2'
  CHECK (tier IN ('T1','T1_5','T2'));
ALTER TABLE collection_source ADD COLUMN owner_entity_id TEXT;

-- Classify exact subscriptions from the current catalog, never by a user-editable label.
UPDATE collection_source cs SET tier=known.tier,owner_entity_id=known.owner,
  revision=revision+1,updated_at=now()
FROM (VALUES
  ('https://blog.cloudflare.com/rss/', 'T1', 'cloudflare'),
  ('https://blog.rust-lang.org/feed.xml', 'T1', 'rust'),
  ('https://www.debian.org/News/news', 'T1', 'debian'),
  ('https://www.djangoproject.com/rss/weblog/', 'T1', 'django'),
  ('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom', 'T1', 'usgs'),
  ('https://www.ecb.europa.eu/rss/press.html', 'T1', 'ecb'),
  ('https://www.eff.org/rss/updates.xml', 'T1', 'eff'),
  ('https://www.federalreserve.gov/feeds/press_all.xml', 'T1', 'federal-reserve'),
  ('https://github.blog/feed/', 'T1', 'github'),
  ('https://go.dev/blog/feed.atom', 'T1', 'go'),
  ('https://huggingface.co/blog/feed.xml', 'T1', 'hugging-face'),
  ('https://kubernetes.io/feed.xml', 'T1', 'kubernetes'),
  ('https://www.nasa.gov/feed/', 'T1', 'nasa'),
  ('https://www.postgresql.org/news.rss', 'T1', 'postgresql'),
  ('https://www.w3.org/blog/feed/', 'T1', 'w3c'),
  ('https://www.who.int/rss-feeds/news-english.xml', 'T1', 'who'),
  ('https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw', 'T1_5', '3blue1brown'),
  ('https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw', 'T1_5', 'linus-tech-tips'),
  ('https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ', 'T1_5', 'mkbhd'),
  ('https://www.youtube.com/feeds/videos.xml?channel_id=UCX6OQ3DkcsbYNE6H8uQQuVA', 'T1_5', 'mrbeast'),
  ('https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA', 'T1_5', 'veritasium')
) AS known(url,tier,owner)
WHERE cs.primary_provider='feed' AND cs.target->>'url'=known.url;

CREATE INDEX idx_content_discovery_first_fetched ON content_discovery(first_fetched_at,content_id);
COMMIT;
