import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { EChartsOption } from 'echarts';
import { formatApiError, useLoginMutation, useRegisterMutation } from '../api/hooks';
import { useI18n } from '../i18n/translations';
import { SiftlineLogo } from './BrandMark';
import { useLogo } from './brandContext';
import { useTheme } from './themeContext';
import { EChartBox } from './charts/EChartBox';
import { useChartColors } from './charts/chartUtils';
import { AccountEmailStart } from './AccountEmail';
import { MfaLoginForm } from './AdministratorMfa';

interface AuthModalProps {
  initialTab?: 'login' | 'register';
  initialQueryContext?: string;
  publicRegistration?: boolean;
  turnstileSiteKey?: string;
  reason?: string;
  inline?: boolean;
  onClose?: () => void;
  onSuccess: () => void;
}

const PREVIEW_SERIES: Record<'7' | '30' | '90', { disc: string; match: string; pain: string; reddit: number[]; bluesky: number[]; labels: string[] }> = {
  '7': {
    disc: '3,412',
    match: '2,187',
    pain: '386',
    reddit: [310, 345, 298, 412, 465, 510, 588],
    bluesky: [110, 128, 122, 155, 174, 196, 224],
    labels: ['11/12', '11/13', '11/14', '11/15', '11/16', '11/17', '11/18'],
  },
  '30': {
    disc: '12,847',
    match: '9,326',
    pain: '1,204',
    reddit: [280, 320, 305, 410, 385, 468, 442, 540, 512, 608, 594, 682, 648, 742],
    bluesky: [118, 134, 126, 172, 160, 198, 184, 226, 210, 254, 246, 286, 274, 318],
    labels: ['10/20', '10/23', '10/26', '10/29', '11/01', '11/04', '11/06', '11/09', '11/11', '11/13', '11/15', '11/16', '11/17', '11/18'],
  },
  '90': {
    disc: '38,209',
    match: '27,884',
    pain: '3,612',
    reddit: [1420, 1680, 1590, 1890, 2140, 2080, 2410, 2650, 2890, 3120, 3380, 3640, 3910],
    bluesky: [560, 620, 590, 710, 840, 810, 930, 1020, 1140, 1260, 1340, 1490, 1620],
    labels: ['W34', 'W35', 'W36', 'W37', 'W38', 'W39', 'W40', 'W41', 'W42', 'W43', 'W44', 'W45', 'W46'],
  },
};

export function AuthModal({
  initialTab = 'login',
  initialQueryContext,
  publicRegistration = false,
  turnstileSiteKey,
  reason,
  inline = false,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const { lang, setLang, t } = useI18n();
  const { activeLogo, setSwitcherOpen } = useLogo();
  const { setStudioOpen } = useTheme();
  const chartColors = useChartColors();

  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [invite, setInvite] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(false);
  const [previewRange, setPreviewRange] = useState<'7' | '30' | '90'>('30');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recover, setRecover] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState('');

  const loginMutation = useLoginMutation();
  const registerMutation = useRegisterMutation();

  useEffect(() => {
    if (inline || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inline, onClose]);

  const isValidLoginEmail = (val: string) =>
    /^[^\s@]+@[^\s@]+$/.test(val) && val.length >= 3 && val.length <= 254;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleaned = email.trim();
    if (!isValidLoginEmail(cleaned)) {
      setError(t('Please enter a valid work email (3..254 characters).', '请输入有效的工作邮箱地址（3..254 字符）。'));
      return;
    }
    if (password.length < 1 || password.length > 128) {
      setError(t('Please enter your password (1..128 characters).', '请输入登录密码（1..128 位字符）。'));
      return;
    }
    try {
      const result = await loginMutation.mutateAsync({ email: cleaned, password, remember });
      if ('mfaRequired' in result) {
        setPassword('');
        setMfaChallenge(result.challenge);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(formatApiError(err));
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const cleaned = email.trim();
    if (!isValidLoginEmail(cleaned)) {
      setError(t('Please enter a valid work email address.', '请输入有效的工作邮箱地址。'));
      return;
    }
    const trimmedInvite = invite.trim();
    if (!publicRegistration && trimmedInvite.length < 12) {
      setError(t('Valid one-time invite code (72 chars) is required.', '请输入管理员分发的有效一次性邀请码。'));
      return;
    }
    if (password.length < 12) {
      setError(
        t(
          'Password must be at least 12 characters.',
          '注册密码长度必须至少 12 位字符。',
        ),
      );
      return;
    }
    if (password !== confirmPw) {
      setError(t('Passwords do not match.', '两次输入的密码不一致。'));
      return;
    }
    try {
      const res = await registerMutation.mutateAsync({
        email: cleaned,
        password,
        invite: trimmedInvite || undefined,
      });
      if (res.user) {
        onSuccess();
        return;
      }
      setNotice(t('Account created cleanly. Please sign in with your new credentials.', '账号已创建成功，请使用新密码登录。'));
      setTab('login');
      setPassword('');
      setConfirmPw('');
    } catch (err) {
      setError(formatApiError(err));
    }
  };

  const submitting = loginMutation.isPending || registerMutation.isPending;

  const previewData = PREVIEW_SERIES[previewRange];
  const previewChartOption: EChartsOption = useMemo(
    () => ({
      grid: { left: 4, right: 4, top: 8, bottom: 4, containLabel: false },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1b221a',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 11 },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: previewData.labels,
        show: false,
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#eef0e9' } },
        axisLabel: { show: false },
      },
      series: [
        {
          name: 'Reddit',
          type: 'line',
          smooth: 0.25,
          symbol: 'none',
          lineStyle: { width: 2, color: chartColors.purple },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${chartColors.purple}44` },
                { offset: 1, color: `${chartColors.purple}00` },
              ],
            },
          },
          data: previewData.reddit,
        },
        {
          name: 'Bluesky',
          type: 'line',
          smooth: 0.25,
          symbol: 'none',
          lineStyle: { width: 1.5, type: 'dashed', color: chartColors.teal },
          data: previewData.bluesky,
        },
      ],
    }),
    [previewData, chartColors.purple, chartColors.teal],
  );

  const shell = (
    <div
      className="auth-shell"
      role={inline ? undefined : 'dialog'}
      aria-modal={inline ? undefined : true}
      aria-label={tab === 'login' ? t('Sign in to SIFTLINE', '登录 SIFTLINE') : t('Create SIFTLINE account', '注册 SIFTLINE 账号')}
    >
      {/* ================= Left Form Side ================= */}
      <div className="auth-left">
        <header className="auth-top">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
              title={t('Back to feed', '返回页面')}
            >
              <SiftlineLogo size={28} fontSize={20} />
            </button>
          ) : (
            <div style={{ display: 'inline-flex', alignItems: 'center' }}>
              <SiftlineLogo size={28} fontSize={20} />
            </div>
          )}

          <div className="at-right">
            <button
              type="button"
              className="auth-util-pill"
              onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
              title={t('Switch Language', '切换中英文')}
            >
              <Globe size={12} />
              {lang === 'en' ? '中文' : 'EN'}
            </button>
            <button
              type="button"
              className="auth-util-pill"
              onClick={() => setStudioOpen(true)}
              title={t('Color Skin', '界面色调')}
            >
              <Palette size={12} />
              {t('Skin', '皮肤')}
            </button>
            <span>
              {tab === 'login'
                ? t('No account yet?', '还没有账号？')
                : publicRegistration
                  ? t('Already have an account?', '已经有账号？')
                  : t('Already invited?', '已经有账号？')}
            </span>
            <button
              type="button"
              className="switch-link"
              onClick={() => {
                setTab(tab === 'login' ? 'register' : 'login');
                setRecover(false);
                setMfaChallenge('');
                setError(null);
                setNotice(null);
              }}
            >
              {tab === 'login'
                ? publicRegistration
                  ? t('Create account', '注册账号')
                  : t('Redeem Invite', '邀请码注册')
                : t('Sign in', '去登录')}
            </button>
          </div>
        </header>

        <main className="auth-main">
          <div className="auth-card">
            <p className="auth-eyebrow">
              {tab === 'login'
                ? t('Welcome back', 'Welcome back')
                : publicRegistration
                  ? t('Open registration', '开放注册')
                  : t('Invite only', '邀请制注册')}
            </p>
            <h1>
              {tab === 'login'
                ? t('Back to your signal workbench', '回到你的信号工作台')
                : publicRegistration
                  ? t('Create your SIFTLINE account', '创建你的 SIFTLINE 账号')
                  : t('Join team via invite code', '用邀请码加入团队')}
            </h1>
            <p className="auth-sub">
              {tab === 'login'
                ? t(
                    'Sign in to inspect project trends, thread structures, and team annotations. Every metric links back to source observations.',
                    '登录后继续查看项目趋势、讨论结构与团队批注。所有数字都能回到原始链接与采集快照。',
                  )
                : publicRegistration
                  ? t(
                      'Create a free account with a password of at least 12 characters. An invite code is optional unless joining a team role.',
                      '开放注册已开启。设置至少 12 位密码即可创建账号；若持有团队邀请码也可一并填入。',
                    )
                  : t(
                      'SIFTLINE is an invite-only workspace. Enter the 72-character one-time invite token issued by your owner or admin.',
                      'SIFTLINE 采用邀请制工作区。输入管理员发给你的 72 位一次性邀请码，创建只属于你的登录凭据。',
                    )}
            </p>

            {reason && (
              <div className="ctx-chip" role="status">
                <Lock size={13} color="var(--wb-teal, #258c89)" />
                <span>{reason}</span>
              </div>
            )}

            {initialQueryContext && (
              <div className="ctx-chip">
                <Search size={13} color="var(--wb-teal, #258c89)" />
                <span>{t('Will explore query:', '登录后将自动检索：')}</span>
                <b>{initialQueryContext}</b>
              </div>
            )}

              {mfaChallenge ? <MfaLoginForm challenge={mfaChallenge} onSuccess={onSuccess} onCancel={() => setMfaChallenge('')} />
                : turnstileSiteKey && (tab === 'register' || recover) ? (
                <>
                  <AccountEmailStart key={tab} siteKey={turnstileSiteKey} purpose={tab === 'register' ? 'register' : 'reset'}
                    requireInvite={!publicRegistration} />
                  {recover && <button type="button" className="auth-link" onClick={() => setRecover(false)}>
                    {t('Back to sign in', '返回登录')}
                  </button>}
                </>
              ) : <form className="auth-form" onSubmit={tab === 'login' ? handleLogin : handleRegister} noValidate>
                {error && (
                  <div className="auth-alert">
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{error}</span>
                  </div>
                )}
                {notice && (
                  <div className="auth-alert is-ok">
                    <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{notice}</span>
                  </div>
                )}

                <div className="auth-field">
                  <label htmlFor="auth-email">{t('Work Email', '工作邮箱')}</label>
                  <input
                    id="auth-email"
                    className="auth-input"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                {tab === 'register' && (
                  <div className="auth-field">
                    <label htmlFor="auth-invite">
                      {publicRegistration
                        ? t('Team Invite Code (Optional)', '团队邀请码（可选）')
                        : t('One-Time Invite Code', '一次性邀请码')}
                    </label>
                    <input
                      id="auth-invite"
                      className="auth-input"
                      type="text"
                      autoComplete="off"
                      placeholder={
                        publicRegistration
                          ? t('Leave blank for standard free account', '留空即以免费成员身份注册')
                          : t('72-character invite token', '72 位一次性邀请码')
                      }
                      value={invite}
                      onChange={(e) => setInvite(e.target.value)}
                      required={!publicRegistration}
                    />
                  </div>
                )}

                <div className="auth-field">
                  <label htmlFor="auth-pw">{t('Password', '密码')}</label>
                  <div className="auth-pw-wrap">
                    <input
                      id="auth-pw"
                      className="auth-input"
                      type={showPw ? 'text' : 'password'}
                      autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                      placeholder={tab === 'register' ? t('Minimum 12 characters', '至少 12 位，建议包含数字与符号') : t('Enter password', '输入密码')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="auth-pw-toggle"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? t('Hide password', '隐藏密码') : t('Show password', '显示密码')}
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {tab === 'register' && (
                    <span className="hint">{t('At least 12 characters required by security policy.', '安全规范要求至少 12 位字符，注册后需返回登录获取会话。')}</span>
                  )}
                </div>

                {tab === 'register' && (
                  <div className="auth-field">
                    <label htmlFor="auth-confirm">{t('Confirm Password', '确认密码')}</label>
                    <input
                      id="auth-confirm"
                      className="auth-input"
                      type="password"
                      autoComplete="new-password"
                      placeholder={t('Re-enter password', '再输入一次密码')}
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required
                    />
                  </div>
                )}

                {tab === 'login' && (
                  <div className="auth-row">
                    <label className="auth-check">
                      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                      {t('Keep me signed in on this device', '在此设备上保持登录')}
                    </label>
                    <button
                      type="button"
                      className="auth-link"
                      onClick={() => {
                        if (turnstileSiteKey) setRecover(true);
                        else setNotice(t('Contact your workspace owner for account recovery.', '请联系工作区 Owner 恢复账户。'));
                      }}
                    >
                      {t('Forgot password?', '忘记密码？')}
                    </button>
                  </div>
                )}

                <button
                  className="auth-submit-btn"
                  type="submit"
                  disabled={submitting}
                >
                  <span>
                    {submitting
                      ? t('Authenticating...', '正在验证凭据...')
                      : tab === 'login'
                        ? t('Enter Signal Workbench', '登录工作台')
                        : publicRegistration
                          ? t('Create Account', '注册账号')
                          : t('Create Invited Account', '邀请码注册')}
                  </span>
                  <ArrowRight size={15} />
                </button>
              </form>}

              {tab === 'login' && (
                <>
                  <div className="auth-sep">{t('Or use enterprise identity', '或使用企业身份')}</div>
                  <div className="auth-sso-row">
                    <button
                      type="button"
                      className="auth-sso-btn"
                      onClick={() => setNotice(t('SAML SSO requires workspace IdP configuration by owner.', '企业 SAML SSO 需由管理员完成 IdP 配置后启用。'))}
                    >
                      <ShieldCheck size={14} />
                      {t('Enterprise SSO', '企业 SSO')}
                    </button>
                    <button
                      type="button"
                      className="auth-sso-btn"
                      onClick={() => setNotice(t('Microsoft 365 OAuth is disabled in invite-only cookie mode.', '邀请制工作区默认使用同源 Cookie 会话登录。'))}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" />
                      </svg>
                      Microsoft 365
                    </button>
                  </div>

                  <div className="auth-trust">
                    <span><ShieldCheck size={12} color="#8fa08a" /> Same-Origin Cookie</span>
                    <span><Lock size={12} color="#8fa08a" /> {t('Encrypted Session', '同源会话保护')}</span>
                    <span><Download size={12} color="#8fa08a" /> {t('Export anytime', '随时导出数据')}</span>
                  </div>

                  <div className="auth-demo-box">
                    <div className="auth-demo-head">
                      <div>
                        <div className="db-t">
                          {t('Live Endpoint · Same-Origin /api/v1 Session', '在线实盘 · 同源 /api/v1 Cookie 会话')}
                        </div>
                        <div className="db-v">POST /api/v1/auth/login · Rate limit 5/min/IP</div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="auth-foot">
                <span>© 2026 SIFTLINE</span>
                {onClose && <button type="button" onClick={onClose}>{t('Close', '关闭')}</button>}
              </div>
            </div>
          </main>
        </div>

        {/* ================= Right Visual Preview Side ================= */}
        <aside className="auth-right">
          <div className="ar-rings" aria-hidden="true" />

          <div className="ar-top">
            <span className="ar-label">{t('Illustrative preview · Sample data', '界面示意 · 非实时数据')}</span>
            <span className="ar-since">SIFTLINE</span>
          </div>

          <div className="ar-copy">
            <h2>
              {lang === 'zh' ? (
                <>
                  听见讨论，
                  <br />
                  找到<em>值得回答</em>的那一个。
                </>
              ) : (
                <>
                  Hear the threads,
                  <br />
                  catch the <em>high-signal</em> shift first.
                </>
              )}
            </h2>
            <p>
              {t(
                'Inspect project health, UTC daily buckets with gap integrity, and multi-provider attribution — every metric stays traceable to raw observations.',
                '登录后你会看到项目总览、按 UTC 天分桶趋势与渠道归因。每一个数字都能回到原始链接与采集观测时间。',
              )}
            </p>
          </div>

          <div className="ar-mock-wrap">
            <div className="ar-mock-card">
              <div className="ar-mock-hd">
                <b>{t('Signal Overview (Sample)', '信号总览（示意）')}</b>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#6b756a' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--wb-teal, #258c89)' }} />
                  {t('Sample preview', '示意数据')}
                </div>
              </div>
              <div style={{ padding: '12px 14px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div className="ar-mock-tabs">
                    {(['7', '30', '90'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={previewRange === r ? 'on' : ''}
                        onClick={() => setPreviewRange(r)}
                      >
                        {r}d
                      </button>
                    ))}
                  </div>
                  <span className="tag tag--mint" style={{ height: 20, fontSize: 9.5 }}>
                    {t('Illustrative', '演示样例')}
                  </span>
                </div>

                <div className="ar-mock-kpis">
                  <div>
                    <div className="lab">{t('Discussions', '讨论总量')}</div>
                    <div className="val">{previewData.disc}</div>
                  </div>
                  <div>
                    <div className="lab">{t('Matched', '命中内容')}</div>
                    <div className="val">{previewData.match}</div>
                  </div>
                  <div>
                    <div className="lab">{t('Pain Signal', '痛点讨论')}</div>
                    <div className="val">{previewData.pain}</div>
                  </div>
                </div>

                <EChartBox option={previewChartOption} height={106} />

                <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 9.5, color: '#7d857a' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <i style={{ width: 6, height: 6, borderRadius: '50%', background: chartColors.purple }} /> Reddit
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <i style={{ width: 6, height: 6, borderRadius: '50%', background: chartColors.teal }} /> Bluesky
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <i style={{ width: 6, height: 6, borderRadius: '50%', background: '#f5ae78' }} /> X / Web
                  </span>
                  <span style={{ marginLeft: 'auto', color: '#9aa294' }}>
                    {t('Sample chart', '示意图')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="ar-bottom">
            <div className="ar-quote">
              {t(
                'Stored-sample transparency: every chart, daily bucket, and research note links directly back to persisted source observations.',
                '透明样本口径：所有图表、按日分桶与研究批注均可追溯至已入库的原始观测记录。',
              )}
            </div>
            <div className="ar-stats">
              <div>
                <span>{t('Platforms', '支持平台')}</span>
                <b>4</b>
              </div>
              <div>
                <span>{t('Auth', '鉴权方式')}</span>
                <b>Cookie</b>
              </div>
              <div>
                <span>{t('Storage', '数据底座')}</span>
                <b>PG16</b>
              </div>
            </div>
          </div>
        </aside>
      </div>
  );

  if (inline) {
    return <div className="auth-overlay" style={{ position: 'relative', minHeight: '100vh' }}>{shell}</div>;
  }

  return (
    <div className="auth-overlay">
      {shell}

      {/* Floating Brand Explorer Chip */}
      <button
        type="button"
        className="auth-brand-chip"
        onClick={() => setSwitcherOpen(true)}
        title={t('Explore 30 Brand Logos', '探索 30 套品牌标识')}
      >
        <Sparkles size={13} color="var(--wb-purple, #7659bd)" />
        <span>
          {t('Mark', '标识')} <b>{activeLogo.num}/30</b>
        </span>
      </button>
    </div>
  );
}
