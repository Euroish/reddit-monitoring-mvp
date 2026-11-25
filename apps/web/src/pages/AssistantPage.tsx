import { ArrowUp, BarChart3, BookOpen, Clock, MessageSquare } from 'lucide-react';
import { AssistantBubbleIcon } from '../components/BrandMark';
import { useI18n } from '../i18n/translations';

/**
 * Reserved placeholder workspace for the upcoming SIFTLINE AI Assistant.
 * No live model calls, chat persistence, or backend endpoints are wired in this phase.
 */
export function AssistantPage() {
  const { t } = useI18n();

  const capabilities = [
    {
      icon: MessageSquare,
      title: t('Conversational Q&A', '智能对话'),
      desc: t('Natural-language research exploration and follow-up analysis', '自然语言问答与研究思路交流'),
    },
    {
      icon: BookOpen,
      title: t('Signal & Feed Briefing', '资讯咨询'),
      desc: t('Summarize key feed movements, topic shifts, and emerging alerts', '解读资讯、梳理动态与热点变化'),
    },
    {
      icon: BarChart3,
      title: t('Project Research Copilot', '研究辅助'),
      desc: t('Assist with interpreting project samples, batches, and topic findings', '辅助理解项目数据与分析结果'),
    },
  ];

  return (
    <div className="ds-page">
      <div className="wb-assistant-page">
        <div className="wb-assistant-symbol" aria-hidden="true">
          <AssistantBubbleIcon size={34} strokeWidth={1.6} />
        </div>

        <span className="wb-assistant-badge">
          <Clock size={13} aria-hidden="true" />
          <span>{t('SIFTLINE AI Assistant · Coming Soon', 'SIFTLINE AI 助手 · 功能筹备中')}</span>
        </span>

        <h1>{t('SIFTLINE AI Assistant', 'SIFTLINE AI 助手')}</h1>
        <p className="wb-assistant-lede">
          {t(
            'Your upcoming intelligent research partner for conversational Q&A, news briefing, and project data interpretation.',
            '你的智能研究伙伴。未来将在这里提供自然语言对话、资讯咨询、项目研究辅助与数据解读。',
          )}
        </p>

        <div className="wb-assistant-box" aria-disabled="true">
          <textarea
            disabled
            aria-label={t('Upcoming assistant prompt input', '未来对话输入框（暂未开放）')}
            placeholder={t('Soon you can ask questions about your monitored stories and projects here…', '未来，你可以在这里提出问题…')}
          />
          <div className="wb-assistant-box-foot">
            <span>{t('Chat & Agent tools are not enabled yet', '功能筹备中 · 对话能力尚未接入')}</span>
            <button
              type="button"
              disabled
              aria-label={t('Send (Coming Soon)', '发送（尚未开放）')}
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>

        <div className="wb-assistant-caps">
          {capabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <div key={cap.title} className="ds-card wb-assistant-cap">
                <Icon size={18} className="wb-assistant-cap-ic" aria-hidden="true" />
                <div>
                  <strong>{cap.title}</strong>
                  <p>{cap.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="wb-assistant-note">
          {t(
            'Reserved navigation entry only · AI Release Intelligence remains accessible under Feed & /ai.',
            '以上能力为未来定位说明 · 原有 AI 资讯页面仍可通过「资讯 → AI 情报」或 /ai 正常访问。',
          )}
        </p>
      </div>
    </div>
  );
}
