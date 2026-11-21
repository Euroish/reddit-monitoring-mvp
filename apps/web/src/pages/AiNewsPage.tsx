import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ShieldCheck, Sparkles } from 'lucide-react';
import {
  useAiEventsQuery,
  useAiUpdatesQuery,
  useAiVendorsQuery,
} from '../api/ai-client';
import { AiEventDrawer } from '../components/ai/AiEventDrawer';
import { AiOfficialUpdates } from '../components/ai/AiOfficialUpdates';
import { AiRankingsSection } from '../components/ai/AiRankingsSection';
import { AiTimelineGrid } from '../components/ai/AiTimelineGrid';
import { ReaderDrawer } from '../components/stories/ReaderDrawer';
import {
  type ReaderPreview,
  evidenceToReaderPreview,
} from '../components/stories/readerTypes';
import type { Actor } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import '../styles/ai-center.css';

interface AiNewsPageProps {
  actor?: Actor | null;
  search?: string;
  onNavigate?: (path: string) => void;
  onOpenAuth?: (tab?: 'login' | 'register', reason?: string, pendingTarget?: string) => void;
}

function readEventIdFromSearch(search: string): string | null {
  const sp = new URLSearchParams(search || window.location.search);
  return sp.get('event');
}

export function AiNewsPage({ actor = null, search = '', onNavigate, onOpenAuth }: AiNewsPageProps) {
  const { t } = useI18n();
  const isAdmin = actor?.role === 'owner' || actor?.role === 'admin';

  const [selectedVendor, setSelectedVendor] = useState('');
  const [selectedEventType, setSelectedEventType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatesVendor, setUpdatesVendor] = useState('');
  const [activeEventId, setActiveEventId] = useState<string | null>(() => readEventIdFromSearch(search));
  const [readerPreview, setReaderPreview] = useState<ReaderPreview | null>(null);

  const vendorsQ = useAiVendorsQuery();
  const eventsQ = useAiEventsQuery({
    vendor: selectedVendor || undefined,
    eventType: selectedEventType || undefined,
    status: selectedStatus || undefined,
    q: searchQuery.trim() || undefined,
    limit: 150,
  });
  const updatesQ = useAiUpdatesQuery({
    vendor: updatesVendor || undefined,
    limit: 12,
  });

  const openEvent = useCallback((id: string | null) => {
    setActiveEventId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('event', id);
    else url.searchParams.delete('event');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const onPop = () => setActiveEventId(readEventIdFromSearch(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const vendors = vendorsQ.data?.items ?? [];
  const events = eventsQ.data?.items ?? [];
  const updates = useMemo(() => updatesQ.data?.items ?? [], [updatesQ.data?.items]);

  const openContentById = useCallback(
    (contentId: string) => {
      const matched = updates.find((u) => u.contentId === contentId);
      setReaderPreview({
        id: contentId,
        platform: 'web',
        title: matched?.title ?? t('Official Update', '官方一手更新'),
        url: matched?.url ?? null,
        author: matched?.vendorName ?? matched?.sourceName ?? null,
        excerpt: matched?.summary ?? null,
        thumbnail: null,
        sourceLabel: matched?.sourceName ?? 'AI Official',
        tier: 'T1',
        publishedAt: matched?.publishedAt ?? null,
        discoveredAt: matched?.publishedAt ?? new Date().toISOString(),
        related: [],
      });
    },
    [updates, t],
  );

  return (
    <div className="ai-page">
      <div className="ai-container">
        <header className="ai-hero">
          <div>
            <div className="ai-hero__eyebrow">
              <Sparkles size={13} />
              {t('AI Release Intelligence Center', 'AI 发布日历与模型情报中心')}
            </div>
            <h1 className="ai-hero__title">
              {t('Verified AI Model Releases, Changelogs & Benchmarks', '官方可核验 AI 模型发布时间轴与情报中心')}
            </h1>
            <p className="ai-hero__sub">
              {t(
                'Track official releases across OpenAI, Anthropic, Google DeepMind, DeepSeek, Qwen, Meta, Moonshot, Z.ai, Mistral, and xAI — backed by primary evidence, never rumors.',
                '追踪 OpenAI、Anthropic、Google DeepMind、DeepSeek、Qwen、Meta、Moonshot、Z.ai、Mistral 与 xAI 的官方发布、规格变动与一手动态——全量附带官方证据链，不虚构任何日期或评分。',
              )}
            </p>
          </div>

          <div className="ai-hero__nav">
            <a href="#timeline" className="ai-pill-btn" style={{ textDecoration: 'none' }}>
              <Calendar size={14} /> {t('Timeline', '发布日历')}
            </a>
            <a href="#rankings" className="ai-pill-btn" style={{ textDecoration: 'none' }}>
              {t('Rankings', '能力榜单')}
            </a>
            <a href="#official-updates" className="ai-pill-btn" style={{ textDecoration: 'none' }}>
              {t('Official Updates', '官方动态')}
            </a>
            {isAdmin && onNavigate && (
              <button
                type="button"
                className="ai-pill-btn is-active"
                onClick={() => onNavigate('/admin/queue')}
              >
                <ShieldCheck size={14} /> {t('Review Queue', '进入审核队列')}
              </button>
            )}
          </div>
        </header>

        <AiTimelineGrid
          vendors={vendors}
          events={events}
          loading={vendorsQ.isLoading || eventsQ.isLoading}
          selectedVendor={selectedVendor}
          onSelectVendor={setSelectedVendor}
          selectedEventType={selectedEventType}
          onSelectEventType={setSelectedEventType}
          selectedStatus={selectedStatus}
          onSelectStatus={setSelectedStatus}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSelectEvent={(id) => openEvent(id)}
        />

        <AiRankingsSection />

        <AiOfficialUpdates
          vendors={vendors}
          updates={updates}
          loading={updatesQ.isLoading}
          selectedVendor={updatesVendor}
          onSelectVendor={setUpdatesVendor}
          onOpenEvent={(id) => openEvent(id)}
          onOpenContent={openContentById}
        />
      </div>

      <AiEventDrawer
        eventId={activeEventId}
        onClose={() => openEvent(null)}
        onSelectEvent={(id) => openEvent(id)}
        onOpenContent={openContentById}
      />

      {readerPreview && (
        <ReaderDrawer
          preview={readerPreview}
          actor={actor}
          onOpenAuth={(tab, reason) => onOpenAuth?.(tab, reason, '/ai')}
          onSelectRelated={(ev) => setReaderPreview(evidenceToReaderPreview(ev))}
          onClose={() => setReaderPreview(null)}
        />
      )}
    </div>
  );
}
