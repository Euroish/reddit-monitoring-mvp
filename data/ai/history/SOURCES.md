# Verified Official Sources & Coverage Matrix (`data/ai/history/v1`)

> Last Verified: `2026-11-22`  
> Target Window: `2025-05-01` – `2026-11-22` (plus April 2025 Llama 4 milestone context)

## 1. Official Vendor Sources (Tier A)

| Vendor | Official URLs Verified | Direct Server Fetch Status (2026-11-22) | Date Parsing & Coverage | Known Gaps |
| :--- | :--- | :--- | :--- | :--- |
| **OpenAI** (`openai`) | `https://openai.com/index/`, `https://developers.openai.com/api/docs/changelog` | `developers.openai.com` returns HTTP 403 (Cloudflare); verified via search + official index slugs | Exact `day` precision from announcement dates (2025-06 to 2026-11) | Direct server-side HTML scraping blocked without browser/feed |
| **Anthropic** (`anthropic`) | `https://www.anthropic.com/news`, `https://platform.claude.com/docs/en/release-notes/overview` | `claude.com` region-gated from current host IP; verified via search + official news slugs | Exact `day` precision (2025-05 Claude 4 through 2026-11 Fable 5.2 + Opus 4 retirement) | Direct server-side scraping region-gated on current host |
| **Google / DeepMind** (`google`) | `https://blog.google/technology/ai/`, `https://ai.google.dev/gemini-api/docs/changelog` | `ai.google.dev` fetch timed out from host; verified via `blog.google` index & official posts | Exact `day` precision (2025-05 Gemini 2.5 through 2026-11 Gemini 4 Neon) | `ai.google.dev` changelog unreachable directly from current host |
| **Meta AI** (`meta`) | `https://ai.meta.com/blog/llama-4-multimodal-intelligence/` | Verified via search + official blog URL | Exact `day` precision for Llama 4 Scout & Maverick (2025-04-05) | No official Llama 5 release in 2025-05..2026-11 |
| **DeepSeek** (`deepseek`) | `https://api-docs.deepseek.com/sitemap.xml`, `/news/newsYYMMDD/` | **HTTP 200 direct fetch** (`sitemap.xml` + all 11 `/news/` pages) | Exact `day` precision from URL/page (2025-05-28 to 2026-11-13) | None |
| **Qwen** (`qwen`) | `https://qwenlm.github.io/blog/`, `https://qwen.ai/blog/` | `qwenlm.github.io/blog/` HTTP 200; `qwen.ai/sitemap.xml` HTTP 200 | Exact `day` precision (2025-07 Qwen3-Coder through 2026-11 Qwen4-Max) | `qwen.ai/blog/` uses SPA routing |
| **Moonshot / Kimi** (`moonshot`) | `https://moonshotai.github.io/Kimi-K2/`, `https://www.kimi.com/blog`, `https://platform.moonshot.ai` | Verified via search + official project/platform URLs | `day` precision for K2/K2.5/K2.6/K2.7/K3/K3.1 Pro; `month` precision for K2 Thinking (2025-11) | `kimi.com` blog archive pagination not exposed via sitemap |
| **Z.ai / Zhipu** (`zai`) | `https://z.ai/blog`, `https://docs.bigmodel.cn` | Verified via search + official blog/docs | `day` precision (GLM-4.5..5.2); `month` precision for GLM-5.3 (2026-08) | Sub-article slugs vary across `z.ai` and `bigmodel.cn` |
| **Mistral AI** (`mistral`) | `https://mistral.ai/news/`, `https://docs.mistral.ai/getting-started/changelog/` | `docs.mistral.ai` timed out from host; verified via `mistral.ai/news/` slugs | Exact `day` precision (2025-05 Medium 3 through 2026-10 Large 4) | Direct changelog fetch timed out from current host |
| **xAI** (`xai`) | `https://x.ai/news/`, `https://docs.x.ai/docs/release-notes` | `docs.x.ai` timed out from host; verified via `x.ai/news/` slugs | Exact `day` precision (2025-07 Grok 4 through 2026-10 Grok Voice 3.0) | Direct docs fetch timed out from current host |

## 2. Secondary & Research Sources (Tier B / C — Never Official Date Authority)

| Source | URL | License / Attribution | Allowed Usage |
| :--- | :--- | :--- | :--- |
| **Epoch AI** | `https://epoch.ai/data/notable_ai_models.csv` | CC-BY (Attribution required) | Research leads only (`ai_event_candidate` with `needs_info`); `YYYY-MM-15` and `YYYY-07-01` flagged as suspected padding; excluded from `dist/` |
| **OpenRouter** | `https://openrouter.ai/api/v1/models` | Public API metadata | Route IDs (`aliases.json`) & context lengths only; `created` timestamp never used as official release date |
| **Artificial Analysis** | `https://artificialanalysis.ai/api/v2/language/models/free` | Free tier internal only | Benchmarks only (`ai_benchmark_*`), never release events |
