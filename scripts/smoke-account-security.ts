import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page, type Route } from 'playwright';
import type { AuthUserView, CollectionSource, PublicContent, SavedWorkbenchViewResponseItem, SourceCapability } from '../packages/contracts/src/http.js';

// Stateful browser fixture only: no database, cookie token, provider or external network is used.
const base = new URL(process.env.SMOKE_WEB_BASE_URL ?? 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Account smoke requires loopback');
const now = '2026-10-13T01:00:00.000Z';
const owner: AuthUserView = { id: 'owner-a', email: 'owner@example.test', displayName: 'Synthetic owner', role: 'owner', status: 'active' };
const admin: AuthUserView = { id: 'admin-c', email: 'admin@example.test', displayName: 'Synthetic admin', role: 'admin', status: 'active' };
const users: AuthUserView[] = [owner, admin];
const initialPassword = 'Synthetic-password-123';
const changedPassword = 'Synthetic-new-password-456';
const passwords = new Map([[owner.email, initialPassword], [admin.email, initialPassword]]);
const capability: SourceCapability = { platform: 'reddit', provider: 'demo_reddit', enabled: true, contentKinds: ['post'],
  targetTypes: ['community'], keywordSearch: 'scoped', metrics: [], observationModel: 'archive', refreshByIds: true,
  limitations: ['Synthetic account-flow fixture only.'] };
const source: CollectionSource = { id: 'synthetic-source', platform: 'reddit', provider: 'demo_reddit', label: 'Synthetic shared source',
  target: { type: 'community', community: 'technology' }, contentKind: 'post', createdAt: now, updatedAt: now,
  coverage: 'partial', lastSuccessAt: now, latestPublishedAt: now, state: 'active', group: null,
  schedule: { enabled: false, cadenceSeconds: 3600, overlapSeconds: 300, initialLookbackHours: 24, maxCatchupHours: 6, pageSize: 25, maxPages: 5 },
  refresh: { enabled: false, afterHours: 36, minIntervalHours: 12, maxAttempts: 3, batchSize: 25 }, nextDueAt: null, incrementalTo: null };
const publicItem: PublicContent = { id: 'synthetic-public-item', externalId: 'public-1', platform: 'reddit', kind: 'post',
  title: 'Synthetic shared content', text: 'Stored public fixture shared by authenticated users.', publishedAt: now,
  firstFetchedAt: now, lastFetchedAt: now, availability: 'available', references: [], media: [], platformDetails: { platform: 'reddit', community: 'technology', flair: null, nsfw: null },
  observations: [{ provider: 'demo_reddit', sourceId: source.id, sourceObservedAt: null, fetchedAt: now, timeBasis: 'unknown', maturity: 'unknown', metrics: {}, evidenceKey: 'synthetic-identity-no-source-claim' }] };
const stats = { total: 1, byKind: [{ kind: 'post', count: 1 }], unknownPublishedAtCount: 0, daily: [{ day: '2026-10-13', count: 1 }] };
const auditEntries = [1, 2].map(index => ({ id: `audit-${index}`, actorUserId: owner.id, actorType: 'session',
  action: index === 1 ? 'user.activated' : 'source.updated', resourceType: index === 1 ? 'user' : 'source', resourceId: index === 1 ? 'viewer-b' : source.id,
  outcome: 'succeeded', requestId: `audit-request-${index}`, changes: { status: 'active' }, createdAt: now }));

function privateView(user: AuthUserView): SavedWorkbenchViewResponseItem {
  return { id: `saved-${user.id}`, name: `${user.id} private saved view`, viewKind: 'target', primaryTarget: 'r/technology',
    compareTargets: [], keywords: [user.id], seriesIds: ['heat_price'], routePath: '/target/technology?range=7d', createdAt: now, updatedAt: now };
}

async function signIn(page: Page, email: string, password = initialPassword) {
  if (new URL(page.url()).pathname !== '/login') await page.goto(`${base.origin}/login`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).waitFor();
}

async function visit(page: Page, path: string) {
  await page.locator(`a[href="${path}"]`).first().click();
}

async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const errors: string[] = [], external: string[] = [];
  let activeUser: AuthUserView | null = owner;
  let expireNextSessions = false;
  let lateOwnerRoute: Route | undefined;
  let auditReads = 0;
  let otherSession = true;
  let inviteIssued = false;
  const targetRecord = { id: 'synthetic-target', canonicalName: 'r/technology', status: 'active', favorite: false,
    cadenceHours: null as number | null, notes: 'Stored note', category: 'baseline', revision: 1 };
  const requests: { path: string; actor: string | null; method: string }[] = [];
  try {
    await context.addInitScript(() => localStorage.setItem('reddit-monitoring.language', 'en'));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin) { external.push(url.origin); await route.abort(); return; }
      if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
      const path = url.pathname.slice(4), method = route.request().method();
      requests.push({ path, actor: activeUser?.id ?? null, method });
      const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      const error = (message: string, status = 400) => json({ errorCode: status === 401 ? 'unauthorized' : 'synthetic_rejection', error: message }, status);
      if (path === '/auth/me') return activeUser ? json({ ok: true, requestId: 'synthetic-me', user: activeUser }) : error('Sign in required', 401);
      if (path === '/auth/login') {
        const body = route.request().postDataJSON() as { email: string; password: string };
        const user = users.find(user => user.email === body.email);
        if (!user || passwords.get(body.email) !== body.password) return error('Invalid credentials', 401);
        if (user.status !== 'active') return error('Account is pending activation', 403);
        activeUser = user; otherSession = true;
        return json({ ok: true, requestId: 'synthetic-login', user });
      }
      if (path === '/auth/logout') { activeUser = null; return json({ ok: true, requestId: 'synthetic-logout' }); }
      if (path === '/auth/register') {
        const body = route.request().postDataJSON() as { email: string; password: string; inviteCode: string; displayName: string };
        if (!inviteIssued || body.inviteCode !== 'SYNTHETIC-INVITE') return error('Invalid synthetic invite');
        const user: AuthUserView = { id: 'viewer-b', email: body.email, displayName: body.displayName, role: 'viewer', status: 'pending' };
        users.push(user); passwords.set(user.email, body.password); inviteIssued = false;
        return json({ ok: true, requestId: 'synthetic-register', user });
      }
      if (!activeUser) return error('Sign in required', 401);
      if (path === '/auth/invites') { inviteIssued = true; return json({ ok: true, requestId: 'synthetic-invite', code: 'SYNTHETIC-INVITE', invite: { id: 'synthetic-invite', roleOnAccept: 'viewer', maxUses: 1, usedCount: 0, createdAt: now } }); }
      if (path === '/auth/users') return json({ ok: true, requestId: 'synthetic-users', users });
      const userAction = path.match(/^\/auth\/users\/([^/]+)\/(activate|status|role)$/);
      if (userAction) {
        const target = users.find(user => user.id === userAction[1]);
        if (!target) return error('User missing', 404);
        if (target.id === activeUser.id) return error('Self access change blocked', 409);
        if (activeUser.role !== 'owner' && (userAction[2] === 'role' || target.role !== 'viewer')) return error('Forbidden', 403);
        if (userAction[2] === 'activate') target.status = 'active';
        if (userAction[2] === 'status') target.status = route.request().postDataJSON().status;
        if (userAction[2] === 'role') target.role = route.request().postDataJSON().role;
        return json({ ok: true, requestId: 'synthetic-user-change', user: target });
      }
      if (path === '/auth/sessions') {
        if (expireNextSessions) { expireNextSessions = false; activeUser = null; return error('Synthetic session expired', 401); }
        return json({ ok: true, requestId: 'synthetic-sessions', sessions: [
          { id: `current-${activeUser.id}`, createdAt: now, lastSeenAt: now, expiresAt: '2026-11-13T01:00:00.000Z', current: true },
          ...(otherSession ? [{ id: `other-${activeUser.id}`, createdAt: now, lastSeenAt: now, expiresAt: '2026-11-13T01:00:00.000Z', current: false }] : [])] });
      }
      if (path === '/auth/password') {
        const body = route.request().postDataJSON() as { currentPassword: string; newPassword: string };
        if (body.currentPassword !== passwords.get(activeUser.email)) return error('Current password is incorrect');
        passwords.set(activeUser.email, body.newPassword); activeUser = null;
        return json({ ok: true, requestId: 'synthetic-password', reauthenticate: true });
      }
      if (path === '/auth/sessions/revoke-all' || path.startsWith('/auth/sessions/')) {
        const currentSessionRevoked = path.endsWith('/revoke-all') || path.includes('/current-');
        if (currentSessionRevoked) activeUser = null;
        else otherSession = false;
        return json({ ok: true, requestId: 'synthetic-revoke', currentSessionRevoked });
      }
      if (path === '/v1/ops/audit') {
        auditReads += 1;
        if (activeUser.role === 'viewer') return error('Forbidden', 403);
        return json({ ok: true, requestId: 'synthetic-audit', entries: [auditEntries[url.searchParams.has('cursor') ? 1 : 0]], nextCursor: url.searchParams.has('cursor') ? null : 'synthetic-next' });
      }
      if (path === '/v1/workbench/saved-views') return json({ ok: true, requestId: 'synthetic-saved', views: [privateView(activeUser)] });
      if (path === '/v1/targets/subreddit') return json({ ok: true, requestId: 'synthetic-targets', targets: [targetRecord] });
      if (path === '/v1/targets/subreddit/technology' && method === 'PATCH') {
        const patch = route.request().postDataJSON() as { expectedRevision: number; notes: string; category: string; status: string; favorite: boolean; cadenceHours: number | null };
        if (patch.expectedRevision !== targetRecord.revision) return error('Synthetic target changed during edit', 409);
        targetRecord.notes = patch.notes; targetRecord.category = patch.category; targetRecord.status = patch.status;
        targetRecord.favorite = patch.favorite; targetRecord.cadenceHours = patch.cadenceHours; targetRecord.revision += 1;
        return json({ ok: true, requestId: 'synthetic-target-update', target: targetRecord });
      }
      if (path === '/v1/sources') return json({ ok: true, requestId: 'synthetic-sources', sources: [source], capabilities: [capability], providers: [] });
      if (path === '/v1/content') return json({ ok: true, requestId: 'synthetic-content', items: [publicItem], stats, nextCursor: null });
      if (path === '/v1/content/workbench') {
        if (activeUser.id === owner.id && url.searchParams.get('query') === 'late_owner') { lateOwnerRoute = route; return; }
        return json({ ok: true, requestId: 'synthetic-workbench', stats, byPlatform: [{ platform: 'reddit', count: 1 }], byProvider: [{ provider: 'demo_reddit', count: 1 }] });
      }
      if (path === '/v1/trends/market') return json({ ok: true, requestId: 'synthetic-market', generatedAtIso: now, fromIso: now, toIso: now, targetCount: 0,
        coverage: { scope: 'monitored_targets', label: 'Synthetic scope', description: 'Offline account fixture', monitoredTargetCount: 0 }, rankings: { byHeat: [], bySurge: [], byDispersion: [] } });
      if (path === '/v1/workbench/market') return json({ ok: true, requestId: 'synthetic-market', summary: { rankedTargetCount: 0, breakoutCount: 0, anomalyCount: 0 }, targets: [], leaders: { byHeat: [], bySurge: [], byDispersion: [] }, breakouts: [], anomalies: [] });
      throw new Error(`Unstubbed API ${method} ${path}`);
    });
    const page = await context.newPage(); page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base.origin}/ops/invites`);
    await page.getByRole('button', { name: 'Create invite', exact: true }).click();
    await page.getByText('SYNTHETIC-INVITE', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.goto(`${base.origin}/register?inviteCode=SYNTHETIC-INVITE`);
    await page.getByLabel('Email', { exact: true }).fill('viewer@example.test');
    await page.getByLabel('Display name', { exact: true }).fill('Synthetic viewer');
    await page.getByLabel('Password', { exact: true }).fill(initialPassword);
    await page.getByLabel('Confirm password', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByText(/An admin must activate this account/).waitFor();
    await page.getByLabel('Password', { exact: true }).fill(initialPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Account is pending activation', { exact: true }).waitFor();
    await signIn(page, owner.email);
    await visit(page, '/ops/users');
    const ownerCard = page.locator('div').filter({ has: page.getByRole('heading', { name: owner.displayName!, exact: true }) }).filter({ has: page.getByRole('button', { name: 'Disable', exact: true }) }).last();
    assert.equal(await ownerCard.getByRole('button', { name: 'Disable', exact: true }).isDisabled(), true);
    await page.getByLabel('Change role', { exact: true }).last().selectOption('admin');
    await page.getByRole('button', { name: 'Save role', exact: true }).last().click();
    await page.getByText('User updated.', { exact: true }).waitFor();
    await page.getByLabel('Change role', { exact: true }).last().selectOption('viewer');
    await page.getByRole('button', { name: 'Save role', exact: true }).last().click();
    await page.getByRole('button', { name: 'Save role', exact: true }).last().waitFor();
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await visit(page, '/saved');
    await page.getByRole('heading', { name: 'owner-a private saved view', exact: true }).waitFor();
    await visit(page, '/content');
    await page.getByRole('heading', { name: 'Synthetic shared content', exact: true }).waitFor();
    await page.getByLabel('Keyword', { exact: true }).fill('late_owner');
    await Promise.all([page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/content/workbench') && request.url().includes('late_owner')),
      page.getByRole('button', { name: 'Search', exact: true }).click()]);
    expireNextSessions = true;
    await visit(page, '/account');
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await signIn(page, 'viewer@example.test');
    if (!lateOwnerRoute) throw new Error('Missing delayed owner response');
    await lateOwnerRoute.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ errorCode: 'unauthorized', error: 'Late owner 401' }) }).catch(() => {});
    await visit(page, '/saved');
    await page.getByRole('heading', { name: 'viewer-b private saved view', exact: true }).waitFor();
    assert.equal(await page.getByText('owner-a private saved view', { exact: true }).count(), 0);
    await visit(page, '/content');
    await page.getByRole('heading', { name: 'Synthetic shared content', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Keyword', { exact: true }).inputValue(), '');
    assert.equal(await page.getByText('Add a source', { exact: true }).count(), 0);
    const readsBefore = auditReads;
    await page.goto(`${base.origin}/ops/audit`);
    await page.getByRole('heading', { name: 'Access Denied', exact: true }).waitFor();
    assert.equal(auditReads, readsBefore);
    await visit(page, '/account');
    await page.getByRole('button', { name: 'Revoke session other-viewer-b', exact: true }).click();
    await page.getByText('Session revoked.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Revoke session other-viewer-b', exact: true }).count(), 0);
    await page.getByLabel('Current password', { exact: true }).fill(initialPassword);
    await page.getByLabel('New password', { exact: true }).fill(changedPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill('mismatch-password-999');
    await page.getByLabel('Confirm new password', { exact: true }).press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Passwords do not match' }).waitFor();
    await page.getByLabel('Confirm new password', { exact: true }).fill(changedPassword);
    await page.getByRole('button', { name: 'Change password and sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await signIn(page, 'viewer@example.test', changedPassword);
    await visit(page, '/account');
    await page.getByRole('button', { name: 'Revoke all sessions and sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await signIn(page, admin.email);
    await visit(page, '/ops/users');
    assert.equal(await page.getByLabel('Change role', { exact: true }).first().isDisabled(), true);
    await visit(page, '/ops/audit');
    await page.getByRole('heading', { name: 'user.activated', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByRole('heading', { name: 'source.updated', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Previous page', exact: true }).click();
    await page.getByRole('heading', { name: 'user.activated', exact: true }).waitFor();
    await visit(page, '/ops/targets');
    const notes = page.getByLabel('Notes r/technology', { exact: true });
    await notes.fill('Unsaved row note');
    targetRecord.notes = 'Remote stored note'; targetRecord.revision += 1;
    await page.getByRole('button', { name: 'Refresh targets', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'changed while editing' }).waitFor();
    assert.equal(await notes.inputValue(), 'Unsaved row note');
    assert.equal(await page.getByRole('button', { name: 'Save target', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cancel edits', exact: true }).click();
    assert.equal(await notes.inputValue(), 'Remote stored note');
    await notes.fill('Will conflict with another save');
    targetRecord.notes = 'Another remote note'; targetRecord.revision += 1;
    await page.getByRole('button', { name: 'Save target', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic target changed during edit' }).waitFor();
    assert.equal(await notes.inputValue(), 'Will conflict with another save');
    await page.getByRole('button', { name: 'Cancel edits', exact: true }).click();
    assert.equal(await notes.inputValue(), 'Another remote note');
    await notes.fill('Saved row note');
    await page.getByRole('button', { name: 'Save target', exact: true }).click();
    await page.getByText('Target saved.', { exact: true }).waitFor();
    assert.equal(targetRecord.notes, 'Saved row note');
    assert.equal(await page.getByRole('button', { name: 'Save target', exact: true }).isDisabled(), true);
    await notes.fill('Do not lose this draft');
    page.once('dialog', dialog => void dialog.dismiss());
    await visit(page, '/saved');
    assert.equal(new URL(page.url()).pathname, '/ops/targets');
    assert.equal(await notes.inputValue(), 'Do not lose this draft');
    await page.getByRole('button', { name: 'Cancel edits', exact: true }).click();
    await visit(page, '/ops/audit');
    await page.getByTitle('简体中文', { exact: true }).click();
    await page.getByRole('heading', { name: '操作审计', exact: true }).waitFor();
    await page.getByRole('link', { name: '账户', exact: true }).click();
    await page.getByRole('heading', { name: '账户安全', exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ path: 'output/playwright/phase4b-account-mobile.png', fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const result = { ok: true, mode: 'synthetic_api_offline_ui', checked: ['invite→pending→activation→login', 'owner self guard and other-user role change',
      'A→401→B private cache and local draft isolation', 'late A 401 does not expire B', 'viewer source query and audit guard',
      'session revocation', 'keyboard password mismatch and successful reauthentication', 'revoke-all', 'admin role boundary', 'audit pagination',
      'target draft refresh, stale revision conflict, cancel/reload, successful save and cancel navigation', 'Chinese account/audit and 390px layout'],
      externalRequests: 0, errors, requestCount: requests.length };
    await writeFile('output/playwright/phase4b-account-security-evidence.json', JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
