const API_BASE = (window.__API_BASE__ && window.__API_BASE__.replace(/\/$/, '')) || window.location.origin;
let currentEventId = null;
const deadlockCourtErrors = new Map();
const allotmentCourtWarnings = new Map();
let currentCompletedGamesFilter = '';
let currentUser = null;
let accessMode = null; // null | 'viewer' | 'moderator'
let accessToken = null;
let eventDetailPollInterval = null;
/** Prevents overlapping event-detail fetches from stacking during poll. */
let eventDetailLoadInFlight = false;
const localGameScores = new Map();
/** Completed-game score edit panel currently open (blocks poll refresh). */
let editingCompletedScoreGameId = null;
/** In-progress court score editor currently open (blocks poll refresh). */
let editingCourtScoreGameId = null;
/** Snapshot of scores when court editor opened (for discard). */
let courtScoreEditSnapshot = null;

function getGameLocalScore(gameId, teamIndex) {
    const entry = localGameScores.get(gameId);
    if (entry !== undefined) {
        const val = teamIndex === 0 ? entry.team1 : entry.team2;
        return val !== undefined && val !== null ? val : null;
    }
    return null;
}

function setGameLocalScore(gameId, team1, team2) {
    const existing = localGameScores.get(gameId) || {};
    if (team1 !== undefined) existing.team1 = team1;
    if (team2 !== undefined) existing.team2 = team2;
    localGameScores.set(gameId, existing);
}

function isScoreEditingActive() {
    if (editingCompletedScoreGameId || editingCourtScoreGameId) return true;
    const el = document.activeElement;
    return !!(el && el.classList?.contains('score-input') && el.closest('#event-detail'));
}

function readScorePairFromEditor(root, gameId) {
    const inputs = root.querySelectorAll(`.score-input[data-game-id="${gameId}"]`);
    const score1 = parseInt(inputs[0]?.value, 10);
    const score2 = parseInt(inputs[1]?.value, 10);
    return {
        score1: Number.isFinite(score1) ? score1 : 0,
        score2: Number.isFinite(score2) ? score2 : 0,
    };
}

function renderScoreEditor(gameId, score1, score2) {
    return `
        <div class="score-editor" data-game-id="${gameId}">
            <div class="score-stepper">
                <span class="score-team-tag">T1</span>
                <button type="button" class="score-step-btn" data-game-id="${gameId}" data-team="1" data-delta="-1" aria-label="Decrease team 1 score">−</button>
                <input type="number" class="score-input" data-game-id="${gameId}" data-team="1" value="${score1}" min="0" inputmode="numeric" enterkeyhint="done">
                <button type="button" class="score-step-btn" data-game-id="${gameId}" data-team="1" data-delta="1" aria-label="Increase team 1 score">+</button>
            </div>
            <span class="score-vs" aria-hidden="true">:</span>
            <div class="score-stepper">
                <span class="score-team-tag">T2</span>
                <button type="button" class="score-step-btn" data-game-id="${gameId}" data-team="2" data-delta="-1" aria-label="Decrease team 2 score">−</button>
                <input type="number" class="score-input" data-game-id="${gameId}" data-team="2" value="${score2}" min="0" inputmode="numeric" enterkeyhint="done">
                <button type="button" class="score-step-btn" data-game-id="${gameId}" data-team="2" data-delta="1" aria-label="Increase team 2 score">+</button>
            </div>
        </div>
    `;
}

function renderScoreConfirmActions(gameId, { confirmClass = 'score-confirm-btn', discardClass = 'score-discard-btn' } = {}) {
    return `
        <div class="score-confirm-actions">
            <button type="button" class="score-icon-btn score-icon-confirm ${confirmClass}" data-game-id="${gameId}" title="Save score" aria-label="Save score">✓</button>
            <button type="button" class="score-icon-btn score-icon-discard ${discardClass}" data-game-id="${gameId}" title="Cancel" aria-label="Cancel score edit">✕</button>
        </div>
    `;
}

function renderCourtScores(gameId, score1, score2) {
    return `
        <div class="court-scores" data-game-id="${gameId}">
            <div class="court-score-compact">
                <button type="button" class="court-score-display" data-game-id="${gameId}" title="Edit score" aria-label="Edit score">
                    <span class="court-score-value">${score1}-${score2}</span>
                    <span class="court-score-edit-hint">Edit</span>
                </button>
            </div>
            <div class="court-score-expanded hidden" data-game-id="${gameId}">
                <div class="score-editor-row">
                    ${renderScoreEditor(gameId, score1, score2)}
                    ${renderScoreConfirmActions(gameId)}
                </div>
            </div>
        </div>
    `;
}

function renderCourtSide(label, playerNames, sideClass) {
    const names = Array.isArray(playerNames) ? playerNames : [];
    const top = names[0] || '';
    const bottom = names[1] || (names.length === 1 ? '' : names.slice(1).join(', '));
    return `
        <div class="court-side ${sideClass}">
            <div class="court-team-label">${label}</div>
            <div class="court-service-half">
                ${top ? `<div class="court-player-name">${top}</div>` : ''}
            </div>
            <div class="court-service-line" aria-hidden="true"></div>
            <div class="court-service-half">
                ${bottom ? `<div class="court-player-name">${bottom}</div>` : ''}
            </div>
        </div>
    `;
}

function renderCourtMatchSurface(team1Players, team2Players, { empty = false, centerHtml = '' } = {}) {
    if (empty) {
        return `
            <div class="court-match court-match--empty">
                <div class="court-play">
                    ${renderCourtSide('', [], 'court-side-a')}
                    <div class="court-kitchen" aria-hidden="true"></div>
                    <div class="court-divider" aria-hidden="true"><div class="court-net-post"></div></div>
                    <div class="court-kitchen" aria-hidden="true"></div>
                    ${renderCourtSide('', [], 'court-side-b')}
                </div>
                <div class="court-empty-label">Open court</div>
            </div>
        `;
    }
    return `
        <div class="court-match">
            <div class="court-play">
                ${renderCourtSide('Team 1', team1Players, 'court-side-a')}
                <div class="court-kitchen" aria-hidden="true"></div>
                <div class="court-divider">
                    ${centerHtml || '<div class="court-net-badge">NET</div>'}
                    <div class="court-net-post" aria-hidden="true"></div>
                </div>
                <div class="court-kitchen" aria-hidden="true"></div>
                ${renderCourtSide('Team 2', team2Players, 'court-side-b')}
            </div>
        </div>
    `;
}

function syncCourtScoreCompactDisplay(root, gameId) {
    const { score1, score2 } = readScorePairFromEditor(root, gameId);
    const valueEl = root.querySelector(`.court-score-compact .court-score-value`);
    if (valueEl) valueEl.textContent = `${score1}-${score2}`;
    return { score1, score2 };
}

function openCourtScoreEditor(gameId) {
    if (editingCourtScoreGameId && editingCourtScoreGameId !== gameId) {
        closeCourtScoreEditor(editingCourtScoreGameId, { save: false });
    }
    editingCourtScoreGameId = gameId;
    const card = document.querySelector(`.court-game-card[data-game-id="${gameId}"]`);
    const scores = card?.querySelector(`.court-scores[data-game-id="${gameId}"]`);
    if (!scores) return;
    const pair = readScorePairFromEditor(scores, gameId);
    courtScoreEditSnapshot = { gameId, score1: pair.score1, score2: pair.score2 };
    scores.querySelector('.court-score-compact')?.classList.add('hidden');
    scores.querySelector('.court-score-expanded')?.classList.remove('hidden');
    card?.classList.add('is-editing-score');
    const discardBtn = scores.querySelector('.score-icon-discard');
    try { discardBtn?.focus(); } catch {}
}

function applyScorePairToEditor(root, gameId, score1, score2) {
    const inputs = root.querySelectorAll(`.score-input[data-game-id="${gameId}"]`);
    if (inputs[0]) inputs[0].value = String(score1);
    if (inputs[1]) inputs[1].value = String(score2);
    const valueEl = root.querySelector(`.court-score-compact .court-score-value`);
    if (valueEl) valueEl.textContent = `${score1}-${score2}`;
}

async function closeCourtScoreEditor(gameId, { save = true, eventId = null } = {}) {
    const card = document.querySelector(`.court-game-card[data-game-id="${gameId}"]`);
    const scores = card?.querySelector(`.court-scores[data-game-id="${gameId}"]`);
    if (scores) {
        if (!save && courtScoreEditSnapshot?.gameId === gameId) {
            applyScorePairToEditor(scores, gameId, courtScoreEditSnapshot.score1, courtScoreEditSnapshot.score2);
            setGameLocalScore(gameId, courtScoreEditSnapshot.score1, courtScoreEditSnapshot.score2);
        } else {
            const { score1, score2 } = syncCourtScoreCompactDisplay(scores, gameId);
            setGameLocalScore(gameId, score1, score2);
            if (save && eventId) {
                try {
                    await api(`${API_BASE}/events/${eventId}/games/${gameId}/score`, {
                        method: 'POST',
                        body: JSON.stringify({ score_team1: score1, score_team2: score2 })
                    });
                    localGameScores.delete(gameId);
                } catch (err) {
                    // keep local draft on failure
                }
            }
        }
        scores.querySelector('.court-score-expanded')?.classList.add('hidden');
        scores.querySelector('.court-score-compact')?.classList.remove('hidden');
    }
    card?.classList.remove('is-editing-score');
    if (courtScoreEditSnapshot?.gameId === gameId) courtScoreEditSnapshot = null;
    if (editingCourtScoreGameId === gameId) editingCourtScoreGameId = null;
}

function bindScoreEditor(container, eventId, { autoSaveOnBlur = false } = {}) {
    container.querySelectorAll('.score-step-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            const team = parseInt(btn.dataset.team, 10);
            const delta = parseInt(btn.dataset.delta, 10);
            const input = container.querySelector(`.score-input[data-game-id="${gameId}"][data-team="${team}"]`);
            if (!input) return;
            const next = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
            input.value = String(next);
            const pair = readScorePairFromEditor(container, gameId);
            setGameLocalScore(gameId, pair.score1, pair.score2);
            syncCourtScoreCompactDisplay(container.closest('.court-scores') || container, gameId);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    container.querySelectorAll('.score-input').forEach(input => {
        input.addEventListener('focus', () => {
            try { input.select(); } catch {}
        });
        input.addEventListener('input', () => {
            const gameId = input.getAttribute('data-game-id');
            const pair = readScorePairFromEditor(container, gameId);
            setGameLocalScore(gameId, pair.score1, pair.score2);
            syncCourtScoreCompactDisplay(container.closest('.court-scores') || container, gameId);
        });
        input.addEventListener('keydown', (e) => {
            const gameId = input.getAttribute('data-game-id');
            if (!gameId) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                if (container.closest('.court-scores')) {
                    closeCourtScoreEditor(gameId, { save: true, eventId });
                } else {
                    container.querySelector(`.save-score-btn[data-game-id="${gameId}"]`)?.click();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (container.closest('.court-scores')) {
                    closeCourtScoreEditor(gameId, { save: false });
                } else {
                    container.querySelector(`.cancel-score-btn[data-game-id="${gameId}"]`)?.click();
                }
            }
        });
        if (autoSaveOnBlur) {
            input.addEventListener('blur', () => {
                setTimeout(() => {
                    const gameId = input.getAttribute('data-game-id');
                    const scoresRoot = container.closest('.court-scores') || container;
                    const editor = scoresRoot.querySelector(`.score-editor[data-game-id="${gameId}"]`);
                    if (!editor) return;
                    // Still interacting with this court score UI — stay expanded
                    if (scoresRoot.contains(document.activeElement)) return;
                    closeCourtScoreEditor(gameId, { save: true, eventId });
                }, 150);
            });
        }
    });
}

function bindCourtScoreExpand(container, eventId) {
    container.querySelectorAll('.court-score-display').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCourtScoreEditor(btn.dataset.gameId);
        });
    });

    container.querySelectorAll('.score-confirm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeCourtScoreEditor(btn.dataset.gameId, { save: true, eventId });
        });
    });

    container.querySelectorAll('.score-discard-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeCourtScoreEditor(btn.dataset.gameId, { save: false });
        });
    });
}

const app = document.getElementById('main-content');
const navBtns = document.querySelectorAll('.nav-btn');

function getToken() {
  return localStorage.getItem('gm_token');
}

function setUser(user) {
  currentUser = user;
}

function clearUser() {
  currentUser = null;
  localStorage.removeItem('gm_token');
}

function isLoggedIn() {
  return !!getToken();
}

function showToast(msg, opts = {}) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.toggle('toast-warning', !!opts.warning);
    toast.classList.add('show');
    const duration = opts.warning ? 5000 : 3000;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

let currentNickNameMap = new Map();

function buildNickNameMap(players) {
    if (!players || !players.length) return new Map();
    const key = players.map(p => p.id).sort().join(',');
    if (currentNickNameMap.size > 0 && currentNickNameMap.get('__key__') === key) {
        return currentNickNameMap;
    }
    const map = new Map();
    map.set('__key__', key);
    players.forEach(p => map.set(p.id, p.nickName || ''));
    currentNickNameMap = map;
    return map;
}

function getPlayerNickName(playerId, nickNameMap) {
    return nickNameMap.get(playerId) || '';
}

function sortPlayersByNickName(players, nickNameMap) {
    return [...players].sort((a, b) => {
        const nickA = nickNameMap.get(a.id) || a.nickName || '';
        const nickB = nickNameMap.get(b.id) || b.nickName || '';
        if (nickA !== nickB) return nickA.localeCompare(nickB);
        return a.name.localeCompare(b.name);
    });
}

function getPlayerLabel(player, nickNameMap, showNickNames) {
    if (!showNickNames) return player.name;
    const nick = getPlayerNickName(player.id, nickNameMap);
    return nick ? `(${nick}) ` + player.name : player.name;
}

/** Append " - DUPR ID" when the player has one. */
function withDuprId(label, player) {
    if (!player?.duprId) return label;
    return `${label} - ${player.duprId}`;
}

function getPlayerDisplayName(player, nickNameMap, showNickNames, statusMap) {
    const label = getPlayerLabel(player, nickNameMap, showNickNames);
    const escapedLabel = escapeHtml(label);
    if (player.gamesPlayed >= player.targetGames) {
        return `<span class="fulfilled-indicator"></span>${escapedLabel}`;
    }
    return escapedLabel;
}

/** Player-list display: nickname + name, plus DUPR ID when set. */
function getPlayerListDisplayName(player, nickNameMap, showNickNames) {
    const label = withDuprId(getPlayerLabel(player, nickNameMap, showNickNames), player);
    const escapedLabel = escapeHtml(label);
    if (player.gamesPlayed >= player.targetGames) {
        return `<span class="fulfilled-indicator"></span>${escapedLabel}`;
    }
    return escapedLabel;
}

function getGamePlayerDisplayName(playerId, status, nickNameMap) {
    const player = status.players.find(p => p.id === playerId);
    if (!player) return escapeHtml(playerId.slice(0, 8));
    const label = getPlayerLabel(player, nickNameMap, true);
    const escapedLabel = escapeHtml(label);
    if (player.gamesPlayed >= player.targetGames) {
        return `<span class="fulfilled-indicator"></span>${escapedLabel}`;
    }
    return escapedLabel;
}

async function api(url, options = {}) {
    const token = getToken();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 6000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        };
        if (accessToken) {
            headers['X-Share-Token'] = accessToken;
        }
        const res = await fetch(url, {
            headers,
            signal: controller.signal,
            ...options
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        throw err;
    }
}

function switchView(view) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (eventDetailPollInterval) {
        clearInterval(eventDetailPollInterval);
        eventDetailPollInterval = null;
    }
    eventDetailLoadInFlight = false;
    currentEventId = null;
    editingCompletedScoreGameId = null;
    editingCourtScoreGameId = null;
    courtScoreEditSnapshot = null;
    if (view === 'dashboard') {
        renderDashboard();
    } else if (view === 'events') {
        renderEvents();
    } else if (view === 'players') {
        renderPlayers();
    }
}

function getAccessMode() {
    const params = new URLSearchParams(window.location.search);
    const viewer = params.get('viewer');
    const moderator = params.get('moderator');
    if (viewer) return { mode: 'viewer', token: viewer };
    if (moderator) return { mode: 'moderator', token: moderator };
    const stored = sessionStorage.getItem('gm_access');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.token && parsed.mode) return parsed;
        } catch {}
    }
    return null;
}

function setAccessMode(mode, token) {
    accessMode = mode;
    accessToken = token;
    if (mode && token) {
        sessionStorage.setItem('gm_access', JSON.stringify({ mode, token }));
    } else {
        sessionStorage.removeItem('gm_access');
    }
}

function clearAccessMode() {
    accessMode = null;
    accessToken = null;
    sessionStorage.removeItem('gm_access');
}

function clearShareParamsFromUrl() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('viewer') && !url.searchParams.has('moderator')) return;
    url.searchParams.delete('viewer');
    url.searchParams.delete('moderator');
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash;
    window.history.replaceState({}, '', next);
}

function showWelcomeError(message) {
    const el = document.getElementById('welcome-error');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
}

function clearWelcomeError() {
    const el = document.getElementById('welcome-error');
    if (!el) return;
    el.textContent = '';
    el.classList.add('hidden');
}

function setEnterBtnLoading(loading) {
    const btn = document.getElementById('enter-btn');
    if (!btn) return;
    if (loading) {
        btn.textContent = 'Loading...';
        btn.disabled = true;
        btn.classList.add('loading');
        btn.setAttribute('aria-busy', 'true');
    } else {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.removeAttribute('aria-busy');
    }
}

/**
 * Poll the backend until it responds so Render cold starts can finish
 * before auth/share checks run.
 */
async function waitForBackend() {
    if (!API_BASE || API_BASE === 'null') {
        throw new Error('Cannot connect — open via http://localhost:4444');
    }

    const maxAttempts = 4;
    const attemptTimeoutMs = 30000;
    const retryDelayMs = 2000;

    setEnterBtnLoading(true);
    setDebug('Connecting to server...');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            setDebug(attempt === 1
                ? 'Waking up server...'
                : `Still connecting... (try ${attempt})`);
            console.log('[welcome] backend ping', { attempt, API_BASE });
            await api(`${API_BASE}/api`, { timeoutMs: attemptTimeoutMs });
            console.log('[welcome] backend ready');
            setDebug('Server ready');
            return;
        } catch (err) {
            console.warn(`[welcome] backend ping attempt ${attempt} failed:`, err.message);
            if (attempt >= maxAttempts) {
                throw new Error('Server unavailable — please try again');
            }
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }
}

async function handleInvalidShareAccess(err, mode) {
    clearAccessMode();
    clearShareParamsFromUrl();
    showWelcomeError('Invalid or expired access. Please obtain access from Event Administrator');
    setDebug(`${mode === 'moderator' ? 'Moderator invite' : 'Share'} link invalid — use Login / Enter`);
    const btn = document.getElementById('enter-btn');
    if (btn) btn.classList.remove('hidden');
    await checkAuthState();
}

async function initWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    const video = document.getElementById('welcome-video');
    const btn = document.getElementById('enter-btn');

    if (!screen || !video || !btn) return;

    const access = getAccessMode();
    let videoPlayBlocked = false;

    console.log('[welcome] init start', { API_BASE, hasToken: !!getToken(), accessMode: access?.mode });

    setEnterBtnLoading(true);
    video.muted = true;
    video.volume = 0;
    video.play().catch(() => {
        console.log('[welcome] video autoplay blocked');
        videoPlayBlocked = true;
    });

    btn.onclick = async () => {
        if (btn.disabled || btn.classList.contains('loading')) return;
        console.log('[welcome] button clicked', { isLoggedIn: isLoggedIn(), accessMode, accessToken });
        if (btn.textContent === 'Enter Site' || btn.textContent === '▶ Play & Enter') {
            if (accessToken) {
                const mode = accessMode;
                try {
                    console.log('[welcome] validating share token:', accessToken);
                    const res = await api(`${API_BASE}/share/${accessToken}`);
                    console.log('[welcome] share validation response:', res);
                    clearWelcomeError();
                    setAccessMode(accessMode, accessToken);
                    dismissWelcomeScreen();
                    openEventDetail(res.eventId, true);
                } catch (err) {
                    console.error('[welcome] share validation error:', err);
                    await handleInvalidShareAccess(err, mode);
                }
            } else {
                clearWelcomeError();
                dismissWelcomeScreen();
                switchView('dashboard');
            }
        } else if (btn.textContent === 'Retry') {
            clearWelcomeError();
            await finishWelcomeReady(access, videoPlayBlocked);
        } else {
            clearWelcomeError();
            btn.classList.add('hidden');
            showLoginModal();
        }
    };

    await finishWelcomeReady(access, videoPlayBlocked);
}

async function finishWelcomeReady(access, videoPlayBlocked) {
    const btn = document.getElementById('enter-btn');
    const screen = document.getElementById('welcome-screen');
    if (!btn || !screen) return;

    try {
        await waitForBackend();
    } catch (err) {
        console.error('[welcome] backend warm-up failed:', err);
        setEnterBtnLoading(false);
        btn.textContent = 'Retry';
        setDebug(err.message || 'Server unavailable');
        showWelcomeError('Server is starting up or unavailable. Tap Retry.');
        return;
    }

    clearWelcomeError();

    if (access) {
        setAccessMode(access.mode, access.token);
        setDebug(access.mode === 'moderator' ? 'Checking moderator invite...' : 'Checking share link...');
        screen.classList.add('active');
        try {
            await api(`${API_BASE}/share/${access.token}`, { timeoutMs: 8000 });
            clearWelcomeError();
            setEnterBtnLoading(false);
            btn.textContent = videoPlayBlocked ? '▶ Play & Enter' : 'Enter Site';
            setDebug(access.mode === 'moderator'
                ? 'Moderator access — no login required'
                : 'Shared access — no login required');
        } catch (err) {
            console.error('[welcome] share validation on init failed:', err);
            await handleInvalidShareAccess(err, access.mode);
        }
        return;
    }

    clearWelcomeError();
    await checkAuthState();
    if (videoPlayBlocked && btn.textContent === 'Enter Site') {
        btn.textContent = '▶ Play & Enter';
    }
}

function setDebug(msg) {
    const debug = document.getElementById('auth-debug');
    if (!debug) return;
    debug.textContent = msg;
    console.log('[auth-debug]', msg);
}

async function checkAuthState() {
    const btn = document.getElementById('enter-btn');
    if (!btn) return;

    const token = getToken();
    console.log('[auth] check start', { token: !!token, API_BASE });

    if (!token) {
        console.log('[auth] no token -> Login/Sign Up');
        setEnterBtnLoading(false);
        btn.textContent = 'Login / Sign Up';
        setDebug('No session found');
        return;
    }

    if (!API_BASE || API_BASE === 'null') {
        console.log('[auth] no API_BASE -> Login/Sign Up');
        setEnterBtnLoading(false);
        btn.textContent = 'Login / Sign Up';
        setDebug('Cannot connect — open via http://localhost:4444');
        return;
    }

    try {
        setDebug('Verifying session...');
        console.log('[auth] calling /auth/me at', `${API_BASE}/auth/me`);
        const user = await api(`${API_BASE}/auth/me`, { timeoutMs: 8000 });
        console.log('[auth] session valid', user.user.name);
        setUser(user.user);
        setEnterBtnLoading(false);
        btn.textContent = 'Enter Site';
        setDebug(`Logged in as ${user.user.name}`);
    } catch (err) {
        console.warn('[auth] session check failed:', err.message);
        clearUser();
        setEnterBtnLoading(false);
        btn.textContent = 'Login / Sign Up';
        setDebug(`Session invalid: ${err.message}`);
    }
}

function logout() {
    clearUser();
    clearAccessMode();
    clearShareParamsFromUrl();
    if (eventDetailPollInterval) {
        clearInterval(eventDetailPollInterval);
        eventDetailPollInterval = null;
    }
    currentEventId = null;
    deadlockCourtErrors.clear();
    allotmentCourtWarnings.clear();
    localGameScores.clear();
    editingCompletedScoreGameId = null;
    editingCourtScoreGameId = null;
    courtScoreEditSnapshot = null;

    const screen = document.getElementById('welcome-screen');
    const video = document.getElementById('welcome-video');
    const btn = document.getElementById('enter-btn');
    if (screen) screen.classList.add('active');
    if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
    }
    if (btn) {
        btn.classList.remove('hidden');
        btn.textContent = 'Login / Sign Up';
    }
    clearWelcomeError();
    setDebug('Logged out');
    if (app) app.innerHTML = '';
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === 'dashboard'));
    showToast('Logged out');
}

function dismissWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    const video = document.getElementById('welcome-video');
    if (screen) screen.classList.remove('active');
    if (video) video.pause();
}

async function showLoginModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'login-modal';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Welcome</div>
                <button class="modal-close" onclick="closeLoginModal()">&times;</button>
            </div>
            <div class="auth-tabs">
                <button class="auth-tab active" id="tab-login" onclick="switchAuthTab('login')">Login</button>
                <button class="auth-tab" id="tab-signup" onclick="switchAuthTab('signup')">Sign Up</button>
            </div>
            <form id="login-form">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="login-email" required placeholder="you@example.com">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="login-password" required placeholder="••••••">
                </div>
                <button type="submit" class="btn btn-primary">Login</button>
            </form>
            <form id="signup-form" class="hidden">
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="signup-name" required placeholder="Your name">
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" id="signup-email" required placeholder="you@example.com">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" id="signup-password" required placeholder="At least 6 characters">
                </div>
                <button type="submit" class="btn btn-primary">Sign Up</button>
            </form>
            <div class="auth-divider"><span>or</span></div>
            <div class="social-login">
                <button class="btn btn-social btn-github" id="btn-github-login">
                    <span class="social-icon">&#128187;</span> Continue with GitHub
                </button>
                <button class="btn btn-social btn-google" id="btn-google-login">
                    <span class="social-icon">&#127758;</span> Continue with Google
                </button>
            </div>
            <div id="auth-error" class="auth-error hidden"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const authError = document.getElementById('auth-error');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    if (!API_BASE || API_BASE === 'null') {
        authError.textContent = 'Cannot connect to server. Open the app via http://localhost:4444 or deploy it.';
        authError.classList.remove('hidden');
        loginForm.querySelectorAll('input, button[type="submit"]').forEach(el => el.disabled = true);
        signupForm.querySelectorAll('input, button[type="submit"]').forEach(el => el.disabled = true);
        return;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.classList.add('hidden');
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            const res = await api(`${API_BASE}/auth/login`, {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            localStorage.setItem('gm_token', res.token);
            setUser(res.user);
            closeLoginModal();
            dismissWelcomeScreen();
            switchView('dashboard');
            showToast('Welcome back!');
        } catch (err) {
            authError.textContent = err.message;
            authError.classList.remove('hidden');
        }
    });

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.classList.add('hidden');
        const name = document.getElementById('signup-name').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        try {
            const res = await api(`${API_BASE}/auth/register`, {
                method: 'POST',
                body: JSON.stringify({ name, email, password })
            });
            localStorage.setItem('gm_token', res.token);
            setUser(res.user);
            closeLoginModal();
            dismissWelcomeScreen();
            switchView('dashboard');
            showToast('Account created!');
        } catch (err) {
            authError.textContent = err.message;
            authError.classList.remove('hidden');
        }
    });

    document.getElementById('btn-github-login').addEventListener('click', () => {
        window.location.href = `${API_BASE}/auth/github?redirect_to=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    });

    document.getElementById('btn-google-login').addEventListener('click', () => {
        window.location.href = `${API_BASE}/auth/google?redirect_to=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    });
}

function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) modal.remove();
    if (!isLoggedIn()) {
        const btn = document.getElementById('enter-btn');
        if (btn) btn.classList.remove('hidden');
    }
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
    } else {
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');
        loginTab.classList.remove('active');
        signupTab.classList.add('active');
    }
    document.getElementById('auth-error').classList.add('hidden');
}

function renderDashboard() {
    const user = currentUser || { name: 'Player', email: '' };
    app.innerHTML = `
        <div class="dashboard-header">
            <div class="user-info">
                <div class="user-avatar">${escapeHtml(user.name.charAt(0).toUpperCase())}</div>
                <div class="user-meta">
                    <div class="user-name">${escapeHtml(user.name)}</div>
                    <div class="user-email">${escapeHtml(user.email || '')}</div>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn btn-secondary btn-sm" id="logout-btn">Logout</button>
            </div>
        </div>
        <div class="flex justify-between items-center mb-2">
            <h2 class="card-title">My Events</h2>
            <button class="btn btn-primary btn-sm" id="create-event-btn">+ New</button>
        </div>
        <div id="events-list">Loading...</div>
    `;
    document.getElementById('create-event-btn').addEventListener('click', openCreateEventModal);
    document.getElementById('logout-btn').addEventListener('click', () => {
        if (confirm('Logout? You will need to sign in again to access your events and players.')) {
            logout();
        }
    });
    loadEventsList();
}

navBtns.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function showBackButton() {
    return `<button class="icon-btn" id="back-btn">&#8592;</button>`;
}

function renderEvents() {
    app.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <h2 class="card-title">Events</h2>
            <button class="btn btn-primary btn-sm" id="create-event-btn">+ New</button>
        </div>
        <div id="events-list">Loading...</div>
    `;
    document.getElementById('create-event-btn').addEventListener('click', openCreateEventModal);
    loadEventsList();
}

async function loadEventsList() {
    try {
        const [ownedEvents, sharedEvents] = await Promise.all([
            api(`${API_BASE}/events`).catch(() => []),
            api(`${API_BASE}/events/shared`).catch(() => [])
        ]);
        const allEvents = [...(ownedEvents || []), ...(sharedEvents || [])];
        const container = document.getElementById('events-list');
        if (!allEvents.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128197;</div>
                    <p>No events yet. Create one to get started!</p>
                </div>`;
            return;
        }
        const sharedIds = new Set((sharedEvents || []).map(e => e.id));
        container.innerHTML = allEvents.map(e => {
            const isShared = sharedIds.has(e.id) || (e.sharedAccess && e.sharedAccess.length > 0);
            const isOwner = currentUser && e.ownerId === currentUser.id;
            let actionHtml = '';
            if (isOwner) {
                const unshare = isShared
                    ? `<span class="delete-link unshare-btn" data-event-id="${e.id}">Unshare</span> `
                    : '';
                actionHtml = `
                    <span class="delete-link rename-event-btn" data-event-id="${e.id}" data-event-name="${escapeHtml(e.name)}">Rename</span>
                    <span class="delete-link copy-event-btn" data-event-id="${e.id}" data-event-name="${escapeHtml(e.name)}">Copy</span>
                    ${unshare}<span class="delete-link delete-event-btn" data-event-id="${e.id}">Delete</span>`;
            } else {
                actionHtml = '<span class="text-muted" style="font-size:11px;">Shared</span>';
            }
            return `
            <div class="list-item" data-event-id="${e.id}">
                <div style="flex:1">
                    <div class="list-item-title">${escapeHtml(e.name)}${isShared ? ' <span class="shared-badge">Shared</span>' : ''}</div>
                    <div class="list-item-meta">ID: ${e.id.slice(0,8)}... | ${e.totalGamesToPlay} games | ${e.courts || 0} courts</div>
                </div>
                <div class="list-item-actions">${actionHtml}</div>
            </div>
        `;
        }).join('');
        container.querySelectorAll('.list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.list-item-actions')) return;
                openEventDetail(item.dataset.eventId);
            });
        });
        container.querySelectorAll('.rename-event-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openRenameEventModal(btn.dataset.eventId, btn.dataset.eventName || '');
            });
        });
        container.querySelectorAll('.copy-event-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCopyEventModal(btn.dataset.eventId, btn.dataset.eventName || '');
            });
        });
        container.querySelectorAll('.delete-event-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const eventId = btn.dataset.eventId;
                if (!confirm('Delete this event? This cannot be undone.')) return;
                try {
                    await api(`${API_BASE}/events/${eventId}`, { method: 'DELETE' });
                    showToast('Event deleted');
                    loadEventsList();
                } catch (err) {
                    showToast(err.message);
                }
            });
        });
        container.querySelectorAll('.unshare-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const eventId = btn.dataset.eventId;
                if (!confirm('Remove all share links for this event?')) return;
                try {
                    await api(`${API_BASE}/events/${eventId}/share`, { method: 'DELETE' });
                    showToast('All share links removed');
                    loadEventsList();
                } catch (err) {
                    showToast(err.message);
                }
            });
        });
    } catch (err) {
        app.innerHTML = `<div class="empty-state"><p class="text-danger">Failed to load events</p><p class="text-muted">${escapeHtml(err.message)}</p></div>`;
    }
}

function openCreateEventModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Create Event</div>
                <button class="modal-close">&times;</button>
            </div>
            <form id="create-event-form">
                <div class="form-group">
                    <label>Event Name</label>
                    <input type="text" name="name" required placeholder="e.g. Friday Night Pickleball">
                </div>
                <div class="form-group">
                    <label>Allowed number of Games per player</label>
                    <input type="number" name="totalGamesToPlay" required min="1" value="6">
                </div>
                <div class="form-group">
                    <label>Number of Courts</label>
                    <input type="number" name="numCourts" required min="1" value="2">
                </div>
                <button type="submit" class="btn btn-primary">Create Event</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('create-event-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = (fd.get('name') || '').trim();
        const totalGamesToPlay = parseInt(fd.get('totalGamesToPlay'));
        const numCourts = parseInt(fd.get('numCourts'));

        if (!name) {
            showToast('Event Name is required');
            return;
        }
        if (!totalGamesToPlay || totalGamesToPlay < 1) {
            showToast('Allowed Games per Player must be at least 1');
            return;
        }
        if (!numCourts || numCourts < 1) {
            showToast('Court Count must be at least 1');
            return;
        }

        try {
            await api(`${API_BASE}/events`, {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    totalGamesToPlay,
                    numCourts
                })
            });
            overlay.remove();
            loadEventsList();
            showToast('Event created!');
        } catch (err) {
            showToast(err.message);
        }
    });
}

function openRenameEventModal(eventId, currentName) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Rename Event</div>
                <button class="modal-close">&times;</button>
            </div>
            <form id="rename-event-form">
                <div class="form-group">
                    <label>Event Name</label>
                    <input type="text" name="name" required value="${escapeHtml(currentName)}">
                </div>
                <button type="submit" class="btn btn-primary">Save</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const nameInput = overlay.querySelector('input[name="name"]');
    if (nameInput) {
        nameInput.focus();
        nameInput.select();
    }
    document.getElementById('rename-event-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (new FormData(e.target).get('name') || '').trim();
        if (!name) {
            showToast('Event Name is required');
            return;
        }
        try {
            await api(`${API_BASE}/events/${eventId}`, {
                method: 'PATCH',
                body: JSON.stringify({ name })
            });
            overlay.remove();
            loadEventsList();
            showToast('Event renamed');
        } catch (err) {
            showToast(err.message);
        }
    });
}

function openCopyEventModal(eventId, currentName) {
    const defaultName = currentName ? `Copy of ${currentName}` : 'Copy of Event';
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Copy Event</div>
                <button class="modal-close">&times;</button>
            </div>
            <p class="text-muted" style="font-size:13px; margin:0 0 12px;">Creates a new unstarted event with the same players. Games and scores are not copied.</p>
            <form id="copy-event-form">
                <div class="form-group">
                    <label>New Event Name</label>
                    <input type="text" name="name" required value="${escapeHtml(defaultName)}">
                </div>
                <button type="submit" class="btn btn-primary">Create Copy</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const nameInput = overlay.querySelector('input[name="name"]');
    if (nameInput) {
        nameInput.focus();
        nameInput.select();
    }
    document.getElementById('copy-event-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (new FormData(e.target).get('name') || '').trim();
        if (!name) {
            showToast('Event Name is required');
            return;
        }
        try {
            await api(`${API_BASE}/events/${eventId}/copy`, {
                method: 'POST',
                body: JSON.stringify({ name })
            });
            overlay.remove();
            loadEventsList();
            showToast('Event copied');
        } catch (err) {
            showToast(err.message);
        }
    });
}

async function openEventDetail(eventId, fromShare = false) {
    currentEventId = eventId;
    navBtns.forEach(b => b.classList.remove('active'));
    app.innerHTML = `
        <div class="app-header">
            ${showBackButton()}
            <div style="flex:1; min-width:0;">
                <h1 id="event-title" style="font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">Event Detail</h1>
                <div id="event-status" class="card-subtitle" style="font-size:11px;"></div>
            </div>
            ${fromShare ? `<div class="shared-badge">Shared</div>` : ''}
            ${accessMode === 'viewer' ? '<div class="shared-badge" style="background:#6b7280;">Viewing</div>' : ''}
            ${accessMode === 'moderator' ? '<div class="shared-badge" style="background:#d97706;">Moderator</div>' : ''}
            <div id="event-actions" style="display:flex; gap:4px;"></div>
        </div>
        ${accessMode === 'viewer' ? '<div class="view-only-banner">You are viewing this event. All actions are disabled.</div>' : ''}
        <div id="event-detail">Loading...</div>
    `;
    document.getElementById('back-btn').addEventListener('click', () => switchView('dashboard'));
    await loadEventDetail(eventId);

    // Auto-refresh event details every 5 seconds (skip while editing scores)
    if (eventDetailPollInterval) clearInterval(eventDetailPollInterval);
    eventDetailPollInterval = setInterval(() => {
        if (currentEventId && !isScoreEditingActive()) {
            loadEventDetail(currentEventId, false, { silent: true });
        }
    }, 5000);
}

async function loadEventDetail(eventId, fromShare = false, options = {}) {
    const silent = !!options.silent;
    if (eventDetailLoadInFlight) return;
    eventDetailLoadInFlight = true;
    try {
        const [event, status] = await Promise.all([
            api(`${API_BASE}/events/${eventId}`, { timeoutMs: 12000 }),
            api(`${API_BASE}/events/${eventId}/status`, { timeoutMs: 12000 })
        ]);

        const container = document.getElementById('event-detail');
        if (!container) return;

        if (accessMode === 'viewer') {
            container.setAttribute('data-readonly', 'true');
        } else {
            container.removeAttribute('data-readonly');
        }

        const activeGames = (event.games || []).filter(g => !g.completed);
        const completedGames = event.gameHistory || [];

        const titleEl = document.getElementById('event-title');
        const statusEl = document.getElementById('event-status');
        if (titleEl) titleEl.textContent = event.name;
        if (statusEl) {
            let statusText = 'Registration Phase';
            if (status.isStarted && !status.isEnded) statusText = 'In Progress';
            else if (status.isEnded) statusText = 'Ended';
            statusEl.textContent = statusText;
        }

        let phaseHtml = '';
        if (!status.isStarted) {
            phaseHtml = renderRegistrationPhase(event, status);
        } else {
            phaseHtml = renderGamePhase(event, status, activeGames, completedGames, fromShare);
        }

        const activeEl = document.activeElement;
        let preservedInput = null;
        if (activeEl && activeEl.closest('#event-detail') && activeEl.classList.contains('score-input')) {
            preservedInput = {
                gameId: activeEl.getAttribute('data-game-id'),
                team: activeEl.getAttribute('data-team'),
                value: activeEl.value,
                selectionStart: activeEl.selectionStart,
                selectionEnd: activeEl.selectionEnd,
            };
        }

        container.innerHTML = phaseHtml;

        if (preservedInput) {
            const input = container.querySelector(`.score-input[data-game-id="${preservedInput.gameId}"][data-team="${preservedInput.team}"]`);
            if (input) {
                input.value = preservedInput.value;
                try { input.focus(); } catch {}
                try {
                    if (typeof preservedInput.selectionStart === 'number') {
                        input.setSelectionRange(preservedInput.selectionStart, preservedInput.selectionEnd);
                    }
                } catch {}
            }
        }

        if (status.isStarted && !status.isEnded && accessMode !== 'moderator') {
            const endBtn = document.createElement('div');
            endBtn.style.cssText = 'text-align:center; margin-top:20px; padding-bottom:20px;';
            endBtn.innerHTML = '<button class="btn btn-danger" id="end-event-btn">End Event</button>';
            container.appendChild(endBtn);
        }

        bindEventDetailActions(eventId, event, status);
        bindCollapsibleSections(eventId, status);
        bindPlayedWithExpand(event);

        const actionsEl = document.getElementById('event-actions');
        if (actionsEl && event.ownerId === (currentUser?.id || '')) {
            actionsEl.innerHTML = `
                <button type="button" class="action-icon-btn" id="share-view-btn" title="Share" aria-label="Share">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                        <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/>
                    </svg>
                </button>
                <button type="button" class="action-icon-btn" id="share-moderate-btn" title="Organize" aria-label="Organize">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="9" cy="7" r="3.5"/>
                        <path d="M2.5 20v-1.2A4.8 4.8 0 0 1 7.3 14h3.4"/>
                        <rect x="13" y="8" width="8.5" height="11" rx="1.5"/>
                        <path d="M15.5 8V6.8a1.2 1.2 0 0 1 1.2-1.2h1.6a1.2 1.2 0 0 1 1.2 1.2V8"/>
                        <path d="M15.2 13h4.1"/>
                        <path d="M15.2 16.2h4.1"/>
                    </svg>
                </button>
                <button type="button" class="action-icon-btn" id="download-excel-btn" title="Download Excel" aria-label="Download Excel">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </button>
            `;
            document.getElementById('share-view-btn')?.addEventListener('click', () => openShareModal(eventId, 'viewer'));
            document.getElementById('share-moderate-btn')?.addEventListener('click', () => openShareModal(eventId, 'moderator'));
            document.getElementById('download-excel-btn')?.addEventListener('click', () => {
                downloadEventExcel(event, status, completedGames);
            });
        }
    } catch (err) {
        // Background polls must not wipe the already-rendered event on transient timeouts.
        if (silent) {
            console.warn('[poll] event detail refresh failed:', err.message);
            return;
        }
        app.innerHTML = `<div class="empty-state"><p class="text-danger">Failed to load event</p><p class="text-muted">${escapeHtml(err.message)}</p></div>`;
    } finally {
        eventDetailLoadInFlight = false;
    }
}

function renderRegistrationPhase(event, status) {
    return `
        <div class="card">
            <div class="card-subtitle mb-2">Progress</div>
            <div class="status-bar">
                <div class="status-chip">
                    <div class="status-value">${status.players.length}</div>
                    <div class="status-label">Registered</div>
                </div>
                <div class="status-chip">
                    <div class="status-value">${event.totalGamesToPlay}</div>
                    <div class="status-label">Target Games</div>
                </div>
                <div class="status-chip">
                    <div class="status-value">${event.courts || 0}</div>
                    <div class="status-label">Courts</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-2">
                <div class="card-title" style="font-size:16px;">Players</div>
                <button class="btn btn-primary btn-sm" id="add-players-btn">+ Add Players</button>
            </div>
            <div id="players-list">
                ${status.players.length ? status.players.map(p => `
                    <div class="player-row">
                        <div class="player-info">
                            <div class="player-name">${escapeHtml(p.name)}<span class="games-played-badge">${p.gamesPlayed || 0}</span></div>
                        </div>
                        <button class="btn btn-danger btn-sm unregister-btn" data-player-id="${p.id}">Unregister</button>
                    </div>
                `).join('') : '<div class="text-muted">No players registered yet</div>'}
            </div>
        </div>

        <button class="btn btn-success" id="start-event-btn" ${status.players.length < 4 ? 'disabled style="opacity:0.6;"' : ''}>
            Start Event
        </button>
        ${status.players.length < 4 ? '<div class="text-center text-muted mt-2">Need at least 4 players to start</div>' : ''}
    `;
}

function renderGamePhase(event, status, activeGames, completedGames, fromShare = false) {
    const maxCourt = event.courts || 1;
    const playerStatusMap = new Map(status.players.map(p => [p.id, p.status]));
    const nickMap = buildNickNameMap(status.players);
    let courtsHtml = '';
    status.courts.forEach(court => {
        const deadlockError = deadlockCourtErrors.get(court.courtId);
        const hasGame = !!court.game;
        const isPlaying = hasGame && court.game.started;
        const isAllotted = hasGame && !court.game.started;
        const allotmentWarning = isAllotted
            ? (court.game.allotmentWarning || allotmentCourtWarnings.get(court.courtId) || '')
            : '';
        if (isAllotted && court.game.allotmentWarning) {
            allotmentCourtWarnings.set(court.courtId, court.game.allotmentWarning);
        }
        if (!isAllotted) {
            allotmentCourtWarnings.delete(court.courtId);
        }
        const stateClass = isPlaying ? 'is-playing' : isAllotted ? 'is-allotted' : 'is-available';

        courtsHtml += `<div class="court-card ${stateClass}" data-court-id="${court.courtId}">
            <div class="court-row">
                <div class="court-header">Court ${court.courtId}</div>
                <div class="court-status">
                    ${isPlaying ? '<span class="court-state-pill court-state-playing">In Progress</span>' : ''}
                    ${isAllotted ? '<span class="court-state-pill court-state-allotted">Allotted</span>' : ''}
                    ${!hasGame ? '<span class="court-state-pill court-state-available">Available</span>' : ''}
                    ${!hasGame && !deadlockError ? `
                        <button class="btn btn-primary btn-sm manual-allot-btn" data-court-id="${court.courtId}">Manual Allot</button>
                        <button class="btn btn-primary btn-sm allot-btn" data-court-id="${court.courtId}">Auto Allot</button>
                    ` : ''}
                </div>
            </div>
            ${deadlockError ? `<div class="court-msg">${escapeHtml(deadlockError)}</div>` : ''}`;

        if (isAllotted) {
            const g = court.game;
            const team1Players = g.team1.map(p => getGamePlayerDisplayName(p.id, status, nickMap));
            const team2Players = g.team2.map(p => getGamePlayerDisplayName(p.id, status, nickMap));
            courtsHtml += `
                <div class="game-card court-game-card" data-game-id="${g.id}">
                    ${allotmentWarning ? `<div class="court-allot-warning">${escapeHtml(allotmentWarning)}</div>` : ''}
                    ${renderCourtMatchSurface(team1Players, team2Players)}
                    <div class="court-footer">
                        <button class="btn btn-success btn-sm start-game-btn" data-game-id="${g.id}">Start Game</button>
                        <button class="btn btn-secondary btn-sm cancel-allot-btn" data-court-id="${court.courtId}">Cancel Allotment</button>
                    </div>
                </div>
            `;
        } else if (isPlaying) {
            const g = court.game;
            const team1Players = g.team1.map(p => getGamePlayerDisplayName(p.id, status, nickMap));
            const team2Players = g.team2.map(p => getGamePlayerDisplayName(p.id, status, nickMap));
            const s1 = getGameLocalScore(g.id, 0);
            const s2 = getGameLocalScore(g.id, 1);
            const score1 = s1 !== null ? s1 : (g.scores ? g.scores[0] : 0);
            const score2 = s2 !== null ? s2 : (g.scores ? g.scores[1] : 0);
            courtsHtml += `
                <div class="game-card court-game-card" data-game-id="${g.id}" data-court-id="${court.courtId}">
                    <div class="court-scores" data-game-id="${g.id}">
                        ${renderCourtMatchSurface(team1Players, team2Players, {
                            centerHtml: `
                                <div class="court-score-compact">
                                    <button type="button" class="court-score-display" data-game-id="${g.id}" title="Edit score" aria-label="Edit score">
                                        <span class="court-score-value">${score1}-${score2}</span>
                                        <span class="court-score-edit-hint">Edit</span>
                                    </button>
                                </div>
                            `
                        })}
                        <div class="court-score-expanded hidden" data-game-id="${g.id}">
                            <div class="score-editor-row">
                                ${renderScoreEditor(g.id, score1, score2)}
                                ${renderScoreConfirmActions(g.id)}
                            </div>
                        </div>
                    </div>
                    <div class="court-footer">
                        <button class="btn btn-success btn-sm end-game-btn" data-game-id="${g.id}">End Game</button>
                        <button class="btn btn-danger btn-sm cancel-game-btn" data-game-id="${g.id}">Cancel Game</button>
                    </div>
                </div>
            `;
        } else {
            courtsHtml += renderCourtMatchSurface([], [], { empty: true });
        }
        courtsHtml += `</div>`;
    });
    
    const waiting = status.players.filter(p => p.status === 'WAITING');
    const playing = status.players.filter(p => p.status === 'PLAYING');
    const away = status.players.filter(p => p.status === 'AWAY');
    const retired = status.players.filter(p => p.status === 'RETIRED');
    const fulfilled = status.players.filter(p => p.status === 'FULLFILLED');
    const nickNameMap = nickMap;

    const renderPlayerGroup = (title, players, showActions) => {
        if (!players.length) return '';
        const sorted = sortPlayersByNickName(players, nickNameMap);
        return `
            <div class="player-group">
                <div class="card-subtitle" style="font-weight:600; margin-bottom:4px; cursor:pointer;" onclick="togglePlayerGroup(this)">${title} (${players.length}) &#9662;</div>
                <div class="player-group-content">
                    ${sorted.map(p => `
                        <div class="player-row">
                            <div class="player-info">
                                <div class="player-name">${getPlayerListDisplayName(p, nickNameMap, true)}<span class="games-played-badge">${p.gamesPlayed || 0}</span></div>
                            </div>
                            ${showActions ? getPlayerActionButtons(p) : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    };

    return `
        <div class="card">
            <div class="card-title" style="font-size:16px;">Leaderboard</div>
            <div id="leaderboard-list">
                ${renderLeaderboard(status, completedGames)}
            </div>
        </div>

        ${!status.isEnded && !fromShare ? `
        <div class="card game-field-card">
            <div class="card-subtitle mb-2 game-field-title">Game Field</div>
            <div class="game-field">
                ${courtsHtml}
            </div>
        </div>
        ` : ''}

        <div class="card">
            <div class="flex justify-between items-center mb-2">
                <div class="card-title" style="font-size:16px; cursor:pointer;" id="players-toggle">Players &#9662;</div>
                ${!status.isStarted ? `<button class="btn btn-primary btn-sm" id="add-players-btn">+ Add Players</button>` : ''}
            </div>
            <div id="players-list" class="${status.isStarted ? 'players-section-collapsed' : ''}">
                ${renderPlayerGroup('Waiting', waiting, true)}
                ${renderPlayerGroup('Playing', playing, false)}
                ${renderPlayerGroup('Fulfilled', fulfilled, true)}
                ${renderPlayerGroup('Away', away, true)}
                ${renderPlayerGroup('Retired', retired, false)}
            </div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-2">
                <div class="card-title" style="font-size:16px; cursor:pointer;" id="completed-games-toggle">Game Stats &#9662;</div>
                <select id="completed-games-player-filter" class="player-filter-select">
                    <option value="">All Players</option>
                    ${(() => sortPlayersByNickName(status.players, nickNameMap).map(p => `<option value="${p.id}" ${currentCompletedGamesFilter === p.id ? 'selected' : ''}>${getPlayerDisplayName(p, nickNameMap, true, playerStatusMap)}</option>`).join(''))()}
                </select>
            </div>
            <div id="completed-games-list">
                ${completedGames.length ? completedGames.filter(g => {
                    if (!currentCompletedGamesFilter) return true;
                    return (g.players.team1 || []).includes(currentCompletedGamesFilter) || (g.players.team2 || []).includes(currentCompletedGamesFilter);
                }).map(g => {
                    const isEditing = editingCompletedScoreGameId === g.id;
                    const local1 = getGameLocalScore(g.id, 0);
                    const local2 = getGameLocalScore(g.id, 1);
                    const score1 = local1 !== null ? local1 : (g.scores ? g.scores[0] : 0);
                    const score2 = local2 !== null ? local2 : (g.scores ? g.scores[1] : 0);
                    return `
                    <div class="game-card completed-game-card${isEditing ? ' is-editing-score' : ''}" data-game-id="${g.id}">
                        <div class="game-teams">
                            <div class="game-team">Team 1: ${g.players.team1.map(id => getGamePlayerDisplayName(id, status, buildNickNameMap(status.players))).join(', ')}</div>
                            <div class="game-team">Team 2: ${g.players.team2.map(id => getGamePlayerDisplayName(id, status, buildNickNameMap(status.players))).join(', ')}</div>
                            <div class="game-status status-completed">Game #${g.gameNumber}</div>
                            <div class="game-meta">
                                court ${g.courtId} | ${g.startedAt ? `Start: ${new Date(g.startedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : ''}
                                ${g.completedAt ? ` | End: ${new Date(g.completedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : ''}
                                ${g.startedAt && g.completedAt ? ` | Duration: ${formatDuration(new Date(g.completedAt).getTime() - new Date(g.startedAt).getTime())}` : ''}
                            </div>
                        </div>
                        <div class="game-score-side">
                            <div class="game-score-row${isEditing ? ' hidden' : ''}" data-game-id="${g.id}">
                                <span class="game-score">${g.scores?.[0] || 0}-${g.scores?.[1] || 0}</span>
                                <button class="btn btn-secondary btn-sm edit-score-btn" data-game-id="${g.id}">Edit Score</button>
                            </div>
                            <div class="game-score-edit${isEditing ? '' : ' hidden'}" data-game-id="${g.id}">
                                <div class="score-editor-row">
                                    ${renderScoreEditor(g.id, score1, score2)}
                                    ${renderScoreConfirmActions(g.id, { confirmClass: 'save-score-btn', discardClass: 'cancel-score-btn' })}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                }).join('') : '<div class="text-muted">No completed games yet</div>'}
             </div>
         </div>
         ${renderPlayedWithCard(event)}
     `;
}

function buildPlayedWithTableHtml(playerIds, matrix, players, { useFullNames = false } = {}) {
    const playerMap = new Map(players.map(p => [p.id, p]));
    const nickNameMap = buildNickNameMap(players);
    const indexMap = new Map(playerIds.map((id, i) => [id, i]));

    // Always sort by nickname so compact and fullscreen matrix positions match
    const order = [...playerIds].sort((a, b) => {
        const nickA = nickNameMap.get(a) || '';
        const nickB = nickNameMap.get(b) || '';
        return nickA.localeCompare(nickB);
    });

    const getLabel = (id) => {
        const player = playerMap.get(id);
        if (useFullNames) {
            return player?.name || id.slice(0, 8);
        }
        return nickNameMap.get(id) || id.slice(0, 8);
    };

    const headerCells = order.map(id =>
        `<th class="played-with-col-header"><span class="played-with-col-label">${escapeHtml(getLabel(id))}</span></th>`
    ).join('');
    const rows = order.map(rowId => {
        const cells = order.map(colId => {
            const i = indexMap.get(rowId);
            const j = indexMap.get(colId);
            const count = matrix[i][j];
            const isDiagonal = rowId === colId;
            let cellClass = '';
            if (isDiagonal) {
                cellClass = 'played-with-self';
            } else if (count === 0) {
                cellClass = 'played-with-zero';
            } else if (count >= 3) {
                cellClass = 'played-with-high';
            }
            return `<td class="${cellClass}">${isDiagonal ? '-' : count}</td>`;
        }).join('');
        return `<tr><th class="played-with-row-header">${escapeHtml(getLabel(rowId))}</th>${cells}</tr>`;
    }).join('');

    return `
        <table class="played-with-matrix${useFullNames ? ' played-with-matrix-names' : ''}">
            <thead>
                <tr><th></th>${headerCells}</tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

function renderPlayedWithCard(event) {
    const { playerIds, matrix, players } = computePlayedWithMatrix(event);

    if (playerIds.length === 0) {
        return '';
    }

    return `
        <div class="card">
            <div class="played-with-header">
                <div class="card-title" style="font-size:16px; cursor:pointer; margin:0; flex:1;" id="played-with-toggle">Who Played with Who &#9662;</div>
                <button type="button" class="btn btn-sm btn-secondary played-with-expand-btn" id="played-with-expand" title="Expand full screen" aria-label="Expand Who Played with Who">⛶</button>
            </div>
            <div id="played-with-list" class="played-with-collapsed">
                <div class="played-with-matrix-container">
                    ${buildPlayedWithTableHtml(playerIds, matrix, players, { useFullNames: false })}
                </div>
            </div>
        </div>
    `;
}

function requestElementFullscreen(el) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!req) return Promise.resolve(false);
    return Promise.resolve(req.call(el)).then(() => true).catch(() => false);
}

function exitDocumentFullscreen() {
    const doc = document;
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement && !doc.msFullscreenElement) return;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
    try { exit?.call(doc); } catch {}
}

function lockLandscapeOrientation() {
    try {
        if (screen.orientation?.lock) {
            return screen.orientation.lock('landscape').then(() => true).catch(() => false);
        }
    } catch {}
    return Promise.resolve(false);
}

function unlockOrientation() {
    try { screen.orientation?.unlock?.(); } catch {}
}

function isPortraitMobile() {
    return window.matchMedia('(orientation: portrait) and (max-width: 900px)').matches;
}

async function openPlayedWithFullscreen(event) {
    const existing = document.getElementById('played-with-fullscreen');
    if (existing) existing.remove();

    const { playerIds, matrix, players } = computePlayedWithMatrix(event);
    if (playerIds.length === 0) return;

    const overlay = document.createElement('div');
    overlay.id = 'played-with-fullscreen';
    overlay.className = 'played-with-fullscreen';
    overlay.innerHTML = `
        <div class="played-with-fullscreen-panel">
            <div class="played-with-fullscreen-header">
                <div class="played-with-fullscreen-title">Who Played with Who</div>
                <button type="button" class="modal-close" id="played-with-fullscreen-close" aria-label="Close">&times;</button>
            </div>
            <div class="played-with-rotate-hint" id="played-with-rotate-hint" hidden>Rotate to landscape for the best view</div>
            <div class="played-with-matrix-container played-with-fullscreen-body">
                ${buildPlayedWithTableHtml(playerIds, matrix, players, { useFullNames: true })}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const hint = overlay.querySelector('#played-with-rotate-hint');
    const updateRotateHint = () => {
        if (!hint) return;
        hint.hidden = !isPortraitMobile();
    };

    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
        orientationMql?.removeEventListener?.('change', updateRotateHint);
        unlockOrientation();
        exitDocumentFullscreen();
        overlay.remove();
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') close();
    };
    const onFullscreenChange = () => {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
        if (!fsEl) close();
    };

    const orientationMql = window.matchMedia('(orientation: portrait)');
    orientationMql.addEventListener?.('change', updateRotateHint);
    updateRotateHint();

    overlay.querySelector('#played-with-fullscreen-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    const enteredFs = await requestElementFullscreen(overlay);
    if (enteredFs) {
        await lockLandscapeOrientation();
        updateRotateHint();
    }
}

function getPlayerActionButtons(player) {
    if (player.status === 'WAITING') {
        return `
            <button class="btn btn-warning btn-sm status-action-btn" data-player-id="${player.id}" data-status="AWAY">Take Break</button>
            <button class="btn btn-danger btn-sm status-action-btn" data-player-id="${player.id}" data-status="RETIRED">Retire</button>
        `;
    } else if (player.status === 'FULLFILLED' || player.status === 'AWAY') {
        return `<button class="btn btn-success btn-sm status-action-btn" data-player-id="${player.id}" data-status="WAITING">I'm Ready</button>`;
    }
    return '';
}

function togglePlayerGroup(header) {
    const content = header.nextElementSibling;
    if (content && content.classList.contains('player-group-content')) {
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        header.innerHTML = header.innerHTML.replace(/ \&#9662;| \&#9652;/, '') + (isHidden ? ' &#9662;' : ' &#9652;');
    }
}

function bindPlayedWithExpand(event) {
    const expandBtn = document.getElementById('played-with-expand');
    if (!expandBtn) return;
    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayedWithFullscreen(event);
    });
}

function bindLeaderboardExpand(eventId) {
    const board = document.querySelector('#leaderboard-list .leaderboard');
    const btn = board?.querySelector('.leaderboard-expand-btn');
    if (!board || !btn) return;

    const storageKey = `gm_event_${eventId}_leaderboard_collapsed`;
    const restCount = Number(btn.dataset.restCount || 0);
    const stored = localStorage.getItem(storageKey);
    // Default collapsed (top 3 only); stored "true" = collapsed, "false" = expanded
    const isCollapsed = stored === null ? true : stored === 'true';

    board.classList.toggle('leaderboard--expanded', !isCollapsed);
    btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    btn.innerHTML = isCollapsed
        ? `Show all ${restCount} more &#9662;`
        : 'Show top 3 &#9652;';

    btn.addEventListener('click', () => {
        const expanded = board.classList.toggle('leaderboard--expanded');
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        btn.innerHTML = expanded
            ? 'Show top 3 &#9652;'
            : `Show all ${restCount} more &#9662;`;
        localStorage.setItem(storageKey, String(!expanded));
    });
}

function bindCollapsibleSections(eventId, status) {
    const sections = [
        {
            listId: 'players-list',
            toggleId: 'players-toggle',
            collapsedClass: 'players-section-collapsed',
            storageKey: `gm_event_${eventId}_players_collapsed`,
            label: 'Players',
            defaultCollapsed: status.isStarted ? true : null,
        },
        {
            listId: 'completed-games-list',
            toggleId: 'completed-games-toggle',
            collapsedClass: 'completed-games-collapsed',
            storageKey: `gm_event_${eventId}_gamestats_collapsed`,
            label: 'Game Stats',
            defaultCollapsed: !status.isEnded ? true : null,
        },
        {
            listId: 'played-with-list',
            toggleId: 'played-with-toggle',
            collapsedClass: 'played-with-collapsed',
            storageKey: `gm_event_${eventId}_playedwith_collapsed`,
            label: 'Who Played with Who',
            defaultCollapsed: status.isStarted ? true : null,
        },
    ];

    for (const section of sections) {
        const list = document.getElementById(section.listId);
        const toggle = document.getElementById(section.toggleId);
        if (!list || !toggle) continue;

        const stored = localStorage.getItem(section.storageKey);
        let isCollapsed;
        if (stored !== null) {
            isCollapsed = stored === 'true';
        } else if (section.defaultCollapsed !== null) {
            isCollapsed = section.defaultCollapsed;
        } else {
            isCollapsed = list.classList.contains(section.collapsedClass);
        }

        list.classList.toggle(section.collapsedClass, isCollapsed);
        toggle.innerHTML = `${section.label} ${isCollapsed ? '&#9662;' : '&#9652;'}`;

        toggle.addEventListener('click', () => {
            const collapsed = list.classList.toggle(section.collapsedClass);
            toggle.innerHTML = `${section.label} ${collapsed ? '&#9662;' : '&#9652;'}`;
            localStorage.setItem(section.storageKey, String(collapsed));
        });
    }

    bindLeaderboardExpand(eventId);
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function randomValidScore() {
    // Winner at 11; opponent 0–9 so score wins by 2 (server validation)
    const winner = 11;
    const loser = Math.floor(Math.random() * 10); // 0–9
    return Math.random() < 0.5 ? [winner, loser] : [loser, winner];
}

function computeLeaderboardStats(status, completedGames) {
    const stats = {};
    for (const p of (status.players || [])) {
        stats[p.id] = { wins: 0, scoreDiff: 0 };
    }

    for (const g of (completedGames || [])) {
        if (!g.scores || g.scores.length < 2) continue;
        const [score1, score2] = g.scores;
        const team1Won = score1 > score2;
        const team2Won = score2 > score1;

        for (const pid of g.players.team1) {
            if (stats[pid]) {
                if (team1Won) stats[pid].wins++;
                stats[pid].scoreDiff += (score1 - score2);
            }
        }
        for (const pid of g.players.team2) {
            if (stats[pid]) {
                if (team2Won) stats[pid].wins++;
                stats[pid].scoreDiff += (score2 - score1);
            }
        }
    }

    const sorted = [...(status.players || [])].filter(p => p.gamesPlayed > 0).sort((a, b) => {
        const wa = stats[a.id]?.wins || 0;
        const wb = stats[b.id]?.wins || 0;
        if (wb !== wa) return wb - wa;
        const da = stats[a.id]?.scoreDiff || 0;
        const db = stats[b.id]?.scoreDiff || 0;
        return db - da;
    });

    return { stats, sorted };
}

function getMedalSvg(metal) {
    const fills = {
        gold: {
            discStops: [
                ['0%', '#ffe082'],
                ['25%', '#f6c000'],
                ['45%', '#e6a800'],
                ['70%', '#ffd54a'],
                ['100%', '#b7791f'],
            ],
            discDark: '#8a5a00',
            rim: '#8a5a00',
            star: '#fff8e1',
            starStroke: '#8a5a00',
            ribbonL: '#2563eb',
            ribbonR: '#1e40af',
            shine: '#ffe9a0',
            sparkle: '#fff3c4',
            glitter: true,
        },
        silver: {
            discStops: [
                ['0%', '#dbe3ec'],
                ['25%', '#9eabb8'],
                ['45%', '#7b8794'],
                ['70%', '#c5ced8'],
                ['100%', '#5b6570'],
            ],
            discDark: '#3f4650',
            rim: '#3f4650',
            star: '#eef2f6',
            starStroke: '#3f4650',
            ribbonL: '#475569',
            ribbonR: '#1e293b',
            shine: '#cfd8e3',
            sparkle: '#e2e8f0',
            glitter: true,
        },
        bronze: {
            discStops: [
                ['0%', '#e8a15a'],
                ['45%', '#c06a2b'],
                ['100%', '#7a3f14'],
            ],
            discDark: '#5c2e0c',
            rim: '#5c2e0c',
            star: '#ffe8cc',
            starStroke: '#5c2e0c',
            ribbonL: '#b45309',
            ribbonR: '#78350f',
            shine: null,
            sparkle: null,
            glitter: false,
        },
    };
    const c = fills[metal];
    const id = `medal-${metal}`;
    const discStops = c.discStops
        .map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`)
        .join('');

    return `
        <svg class="medal-svg${c.glitter ? ' medal-svg--glitter' : ''}" viewBox="0 0 32 40" width="26" height="32" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id="${id}-disc" x1="18%" y1="8%" x2="88%" y2="92%">
                    ${discStops}
                </linearGradient>
                ${c.glitter ? `
                <linearGradient id="${id}-shine" gradientUnits="userSpaceOnUse" x1="-16" y1="18" x2="8" y2="34">
                    <stop offset="0" stop-color="${c.shine}" stop-opacity="0"/>
                    <stop offset="0.45" stop-color="${c.shine}" stop-opacity="0.55"/>
                    <stop offset="0.55" stop-color="${c.shine}" stop-opacity="0.8"/>
                    <stop offset="1" stop-color="${c.shine}" stop-opacity="0"/>
                    <animate attributeName="x1" values="-24;40" dur="2.4s" repeatCount="indefinite"/>
                    <animate attributeName="x2" values="0;64" dur="2.4s" repeatCount="indefinite"/>
                </linearGradient>
                ` : ''}
            </defs>
            <path d="M12 1l4 9h-3L9 1h3z" fill="${c.ribbonL}"/>
            <path d="M20 1l-4 9h3l4-9h-3z" fill="${c.ribbonR}"/>
            <path d="M13 10l-4 12 5-2.5L16 10z" fill="${c.ribbonL}"/>
            <path d="M19 10l4 12-5-2.5L16 10z" fill="${c.ribbonR}"/>
            <circle cx="16" cy="26" r="11" fill="${c.discDark}"/>
            <circle cx="16" cy="26" r="9.2" fill="url(#${id}-disc)"/>
            <circle cx="16" cy="26" r="9.2" fill="none" stroke="${c.rim}" stroke-width="1.2"/>
            ${c.glitter ? `<circle cx="16" cy="26" r="9.2" fill="url(#${id}-shine)"/>` : ''}
            <path d="M16 20.4l1.55 3.15 3.48.5-2.52 2.45.6 3.45L16 28.2l-3.11 1.65.6-3.45-2.52-2.45 3.48-.5z" fill="${c.star}" stroke="${c.starStroke}" stroke-width="0.6" stroke-linejoin="round"/>
            ${c.glitter ? `
            <circle class="medal-sparkle" cx="11.5" cy="21" r="1.15" fill="${c.sparkle}" stroke="${c.rim}" stroke-width="0.35">
                <animate attributeName="opacity" values="0.15;1;0.15;0.15;1;0.15" dur="2.8s" repeatCount="indefinite"/>
            </circle>
            <circle class="medal-sparkle" cx="21" cy="24.5" r="0.95" fill="${c.sparkle}" stroke="${c.rim}" stroke-width="0.35">
                <animate attributeName="opacity" values="0.15;0.15;1;0.15;0.15;1;0.15" dur="3.2s" repeatCount="indefinite"/>
            </circle>
            <circle class="medal-sparkle" cx="15" cy="30.5" r="0.85" fill="${c.sparkle}" stroke="${c.rim}" stroke-width="0.35">
                <animate attributeName="opacity" values="1;0.15;0.15;1;0.15" dur="2.6s" repeatCount="indefinite"/>
            </circle>
            ` : ''}
        </svg>
    `;
}

function getLeaderboardRankBadge(idx) {
    if (idx === 0) {
        return `<div class="leaderboard-rank medal medal-gold" title="Gold" aria-label="Gold">${getMedalSvg('gold')}</div>`;
    }
    if (idx === 1) {
        return `<div class="leaderboard-rank medal medal-silver" title="Silver" aria-label="Silver">${getMedalSvg('silver')}</div>`;
    }
    if (idx === 2) {
        return `<div class="leaderboard-rank medal medal-bronze" title="Bronze" aria-label="Bronze">${getMedalSvg('bronze')}</div>`;
    }
    return `<div class="leaderboard-rank">${idx + 1}</div>`;
}

function renderLeaderboardRow(p, idx, stats, nickNameMap, playerStatusMap) {
    const s = stats[p.id] || { wins: 0, scoreDiff: 0 };
    const diffStr = s.scoreDiff > 0 ? `+${s.scoreDiff}` : `${s.scoreDiff}`;
    const playerLabel = getPlayerDisplayName(p, nickNameMap, true, playerStatusMap);
    const partnersStr = (p.partnerIds || []).map(pid => getPlayerNickName(pid, nickNameMap)).filter(n => n).join(', ') || 'None';
    return `
        <div class="leaderboard-row">
            ${getLeaderboardRankBadge(idx)}
            <div class="leaderboard-player">
                <div class="player-name">${playerLabel}</div>
                <div class="player-meta">Games: ${p.gamesPlayed} | Partners: ${partnersStr}</div>
            </div>
            <div class="leaderboard-stat">${s.wins} <span class="text-muted">wins</span></div>
            <div class="leaderboard-stat">${diffStr} <span class="text-muted">diff</span></div>
        </div>
    `;
}

function renderLeaderboard(status, completedGames) {
    if (!status.players || !status.players.length) {
        return '<div class="text-muted">No players yet</div>';
    }

    const { stats, sorted } = computeLeaderboardStats(status, completedGames);
    if (!sorted.length) {
        return '<div class="text-muted">No players have played any games yet</div>';
    }

    const nickNameMap = buildNickNameMap(status.players);
    const playerStatusMap = new Map(status.players.map(p => [p.id, p.status]));
    const top = sorted.slice(0, 3);
    const rest = sorted.slice(3);

    const topHtml = top.map((p, idx) => renderLeaderboardRow(p, idx, stats, nickNameMap, playerStatusMap)).join('');
    const restHtml = rest.map((p, idx) => renderLeaderboardRow(p, idx + 3, stats, nickNameMap, playerStatusMap)).join('');

    return `
        <div class="leaderboard">
            <div class="leaderboard-top">
                ${topHtml}
            </div>
            ${rest.length ? `
            <div class="leaderboard-rest">
                ${restHtml}
            </div>
            <button type="button" class="leaderboard-expand-btn" data-rest-count="${rest.length}" aria-expanded="false">
                Show all ${rest.length} more &#9662;
            </button>
            ` : ''}
        </div>
    `;
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function excelCell(value, type = 'String') {
    if (value === null || value === undefined || value === '') {
        return '<Cell/>';
    }
    return `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

function excelRow(cells) {
    return `<Row>${cells.join('')}</Row>`;
}

function resolvePlayerNamePlain(playerId, players) {
    const player = (players || []).find(p => p.id === playerId);
    return player?.name || playerId.slice(0, 8);
}

function buildLeaderBoardSheetRows(status, completedGames) {
    const players = status.players || [];
    const playerMap = new Map(players.map(p => [p.id, p]));
    const { stats, sorted } = computeLeaderboardStats(status, completedGames);
    const header = excelRow([
        excelCell('Rank'),
        excelCell('Player'),
        excelCell('Games'),
        excelCell('Wins'),
        excelCell('Score Diff'),
        excelCell('Partners'),
    ]);
    const rows = sorted.map((p, idx) => {
        const s = stats[p.id] || { wins: 0, scoreDiff: 0 };
        const partnersStr = (p.partnerIds || [])
            .map(pid => playerMap.get(pid)?.name)
            .filter(Boolean)
            .join(', ') || 'None';
        return excelRow([
            excelCell(idx + 1, 'Number'),
            excelCell(p.name),
            excelCell(p.gamesPlayed || 0, 'Number'),
            excelCell(s.wins, 'Number'),
            excelCell(s.scoreDiff, 'Number'),
            excelCell(partnersStr),
        ]);
    });
    return [header, ...rows];
}

function buildGameStatsSheetRows(status, completedGames) {
    const players = status.players || [];
    const header = excelRow([
        excelCell('Game #'),
        excelCell('Court'),
        excelCell('Team 1'),
        excelCell('Team 2'),
        excelCell('Score'),
        excelCell('Start'),
        excelCell('End'),
        excelCell('Duration'),
    ]);
    const rows = (completedGames || []).map(g => {
        const team1 = (g.players?.team1 || []).map(id => resolvePlayerNamePlain(id, players)).join(', ');
        const team2 = (g.players?.team2 || []).map(id => resolvePlayerNamePlain(id, players)).join(', ');
        const score = `${g.scores?.[0] || 0}-${g.scores?.[1] || 0}`;
        const start = g.startedAt ? new Date(g.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const end = g.completedAt ? new Date(g.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const duration = (g.startedAt && g.completedAt)
            ? formatDuration(new Date(g.completedAt).getTime() - new Date(g.startedAt).getTime())
            : '';
        return excelRow([
            excelCell(g.gameNumber || '', 'Number'),
            excelCell(g.courtId || '', 'Number'),
            excelCell(team1),
            excelCell(team2),
            excelCell(score),
            excelCell(start),
            excelCell(end),
            excelCell(duration),
        ]);
    });
    return [header, ...rows];
}

function buildPlayedWithSheetRows(event) {
    const { playerIds, matrix, players } = computePlayedWithMatrix(event);
    const playerMap = new Map(players.map(p => [p.id, p]));

    // Reorder by full name for the spreadsheet (no nicknames)
    const order = [...playerIds].sort((a, b) => {
        const nameA = playerMap.get(a)?.name || '';
        const nameB = playerMap.get(b)?.name || '';
        return nameA.localeCompare(nameB);
    });
    const indexMap = new Map(playerIds.map((id, i) => [id, i]));
    const labels = order.map(id => playerMap.get(id)?.name || id.slice(0, 8));

    const header = excelRow([
        excelCell(''),
        ...labels.map(label => excelCell(label)),
    ]);
    const rows = order.map((rowId, i) => {
        const cells = [
            excelCell(labels[i]),
            ...order.map((colId) => {
                if (rowId === colId) return excelCell('-');
                const ri = indexMap.get(rowId);
                const ci = indexMap.get(colId);
                return excelCell(matrix[ri][ci], 'Number');
            }),
        ];
        return excelRow(cells);
    });
    return [header, ...rows];
}

/** YYYY-MM-DD for DUPR import (local calendar date). */
function formatDuprDate(raw) {
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * DUPR score-sheet import format (doubles / SIDEOUT).
 * Columns match DUPR's SCORE_SHEET_DUPR_FORMAT CSV.
 */
function buildDuprSheetRows(event, status, completedGames) {
    const players = status.players || [];
    const playerMap = new Map(players.map(p => [p.id, p]));
    const eventName = event.name || status.eventName || '';
    const date =
        formatDuprDate(event.startedAt) ||
        formatDuprDate(status.startedAt) ||
        formatDuprDate(completedGames?.[0]?.completedAt) ||
        formatDuprDate(completedGames?.[0]?.startedAt);
    const location = 'goPlay, Chennai, India';
    const header = excelRow([
        excelCell('matchType'),
        excelCell('event'),
        excelCell('date'),
        excelCell('playerA1'),
        excelCell('playerA1DuprId'),
        excelCell('playerA1ExternalId'),
        excelCell('playerA2'),
        excelCell('playerA2DuprId'),
        excelCell('playerA2ExternalId'),
        excelCell('playerB1'),
        excelCell('playerB1DuprId'),
        excelCell('playerB1ExternalId'),
        excelCell('playerB2'),
        excelCell('playerB2DuprId'),
        excelCell('playerB2ExternalId'),
        excelCell('teamAGame1'),
        excelCell('teamBGame1'),
        excelCell('teamAGame2'),
        excelCell('teamBGame2'),
        excelCell('teamAGame3'),
        excelCell('teamBGame3'),
        excelCell('teamAGame4'),
        excelCell('teamBGame4'),
        excelCell('teamAGame5'),
        excelCell('teamBGame5'),
        excelCell('location'),
        excelCell('scoreType'),
    ]);

    const resolve = (playerId) => {
        const p = playerMap.get(playerId);
        return {
            name: p?.name || (playerId ? String(playerId).slice(0, 8) : ''),
            duprId: p?.duprId || '',
        };
    };

    const rows = (completedGames || []).map(g => {
        const team1 = g.players?.team1 || [];
        const team2 = g.players?.team2 || [];
        const a1 = resolve(team1[0]);
        const a2 = resolve(team1[1]);
        const b1 = resolve(team2[0]);
        const b2 = resolve(team2[1]);
        const scoreA = g.scores?.[0];
        const scoreB = g.scores?.[1];
        return excelRow([
            excelCell('D'),
            excelCell(eventName),
            excelCell(date),
            excelCell(a1.name),
            excelCell(a1.duprId),
            excelCell(''),
            excelCell(a2.name),
            excelCell(a2.duprId),
            excelCell(''),
            excelCell(b1.name),
            excelCell(b1.duprId),
            excelCell(''),
            excelCell(b2.name),
            excelCell(b2.duprId),
            excelCell(''),
            excelCell(scoreA ?? '', scoreA != null ? 'Number' : 'String'),
            excelCell(scoreB ?? '', scoreB != null ? 'Number' : 'String'),
            excelCell(''),
            excelCell(''),
            excelCell(''),
            excelCell(''),
            excelCell(''),
            excelCell(''),
            excelCell(''),
            excelCell(''),
            excelCell(location),
            excelCell('SIDEOUT'),
        ]);
    });

    return [header, ...rows];
}

function buildExcelWorkbookXml(sheets) {
    const worksheets = sheets.map(sheet => `
 <Worksheet ss:Name="${escapeXml(sheet.name)}">
  <Table>
${sheet.rows.join('\n')}
  </Table>
 </Worksheet>`).join('');

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${worksheets}
</Workbook>`;
}

function sanitizeFileName(name) {
    return String(name || 'event')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80) || 'event';
}

function downloadEventExcel(event, status, completedGames) {
    const xml = buildExcelWorkbookXml([
        { name: 'Leader Board', rows: buildLeaderBoardSheetRows(status, completedGames) },
        { name: 'Game Stats', rows: buildGameStatsSheetRows(status, completedGames) },
        { name: 'Who Played with Who', rows: buildPlayedWithSheetRows(event) },
        { name: 'DUPR Import', rows: buildDuprSheetRows(event, status, completedGames) },
    ]);

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFileName(event.name)}-stats.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Excel downloaded');
}

function bindEventDetailActions(eventId, event, status) {
    const container = document.getElementById('event-detail');
    if (!container) return;

    if (accessMode === 'viewer') {
        container.querySelectorAll('button, .btn, .icon-btn').forEach(btn => {
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';
            btn.disabled = true;
        });
        return;
    }

    const isModerator = accessMode === 'moderator';

    if (!status.isStarted) {
        const startBtn = document.getElementById('start-event-btn');
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                try {
                    await api(`${API_BASE}/events/${eventId}/start`, { method: 'POST' });
                    showToast('Event started!');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        }

        const addBtn = document.getElementById('add-players-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                const currentIds = status.players.map(p => p.id);
                openAddPlayersModal(eventId, new Set(currentIds));
            });
        }

        container.querySelectorAll('.unregister-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const playerId = btn.dataset.playerId;
                if (!confirm('Unregister this player from the event?')) return;
                try {
                    await api(`${API_BASE}/events/${eventId}/players/${playerId}`, { method: 'DELETE' });
                    showToast('Player unregistered');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });
    } else {
        if (!isModerator) {
            const endEventBtn = document.getElementById('end-event-btn');
            if (endEventBtn) {
                endEventBtn.addEventListener('click', async () => {
                    if (!confirm('Are you sure you want to end this event?')) return;
                    try {
                        await api(`${API_BASE}/events/${eventId}/end`, { method: 'POST' });
                        showToast('Event ended');
                        loadEventDetail(eventId);
                    } catch (err) {
                        showToast(err.message);
                    }
                });
            }
        }

        container.querySelectorAll('.allot-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const courtId = btn.dataset.courtId;
                btn.disabled = true;
                btn.textContent = 'Allotting...';
                try {
                    const res = await api(`${API_BASE}/events/${eventId}/courts/${courtId}/allot`, { method: 'POST' });
                    if (res.status && res.status === 'WAITING' && res.message) {
                        deadlockCourtErrors.set(courtId, res.message);
                        allotmentCourtWarnings.delete(courtId);
                        showToast(`Court ${courtId}: ${res.message}`);
                        loadEventDetail(eventId);
                    } else {
                        deadlockCourtErrors.delete(courtId);
                        const warning = res.warning || res.allotmentWarning;
                        if (warning) {
                            allotmentCourtWarnings.set(courtId, warning);
                            showToast(`Court ${courtId} allotted — ${warning}`, { warning: true });
                        } else {
                            allotmentCourtWarnings.delete(courtId);
                            showToast(`Court ${courtId} allotted`);
                        }
                        loadEventDetail(eventId);
                    }
                } catch (err) {
                    if (err.message && err.message.includes('No valid partner/opponent combination found')) {
                        deadlockCourtErrors.set(courtId, err.message);
                        showToast(`Court ${courtId}: Cannot allot right now`);
                        loadEventDetail(eventId);
                    } else {
                        deadlockCourtErrors.set(courtId, err.message);
                        showToast(err.message);
                        loadEventDetail(eventId);
                    }
                }
            });
        });

        container.querySelectorAll('.manual-allot-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const courtId = btn.dataset.courtId;
                openManualAllotModal(eventId, courtId);
            });
        });

        container.querySelectorAll('.cancel-allot-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const courtId = btn.dataset.courtId;
                try {
                    await api(`${API_BASE}/events/${eventId}/courts/${courtId}/allot`, { method: 'DELETE' });
                    deadlockCourtErrors.delete(courtId);
                    allotmentCourtWarnings.delete(courtId);
                    showToast('Allotment cancelled');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });

        container.querySelectorAll('.start-game-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const gameId = btn.dataset.gameId;
                try {
                    await api(`${API_BASE}/events/${eventId}/games/${gameId}/start`, { method: 'POST' });
                    showToast('Game started');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });

        container.querySelectorAll('.end-game-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const gameId = btn.dataset.gameId;
                const card = document.querySelector(`.court-game-card[data-game-id="${gameId}"]`);
                const inputs = card.querySelectorAll('.score-input');
                let score1 = parseInt(inputs[0].value) || 0;
                let score2 = parseInt(inputs[1].value) || 0;
                if (score1 === 0 && score2 === 0) {
                    [score1, score2] = randomValidScore();
                }
                try {
                    const res = await api(`${API_BASE}/events/${eventId}/games/${gameId}/end`, {
                        method: 'POST',
                        body: JSON.stringify({ score_team1: score1, score_team2: score2 })
                    });
                    localGameScores.delete(gameId);
                    showToast('Game ended!');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });

        container.querySelectorAll('.cancel-game-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const gameId = btn.dataset.gameId;
                const card = document.querySelector(`.court-game-card[data-game-id="${gameId}"]`);
                const courtId = card ? card.dataset.courtId : null;
                if (!courtId) {
                    showToast('Cannot determine court for this game');
                    return;
                }
                if (!confirm('Cancel this game? Players will be returned to waiting.')) return;
                try {
                    await api(`${API_BASE}/events/${eventId}/courts/${courtId}/allot`, { method: 'DELETE' });
                    showToast('Game cancelled');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });

        container.querySelectorAll('.court-scores').forEach(el => {
            bindScoreEditor(el, eventId, { autoSaveOnBlur: false });
        });
        bindCourtScoreExpand(container, eventId);

        container.querySelectorAll('.status-action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const playerId = btn.dataset.playerId;
                const newStatus = btn.dataset.status;
                try {
                    await api(`${API_BASE}/events/${eventId}/players/${playerId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: newStatus })
                    });
                    showToast(`Player marked as ${newStatus}`);
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });
    }

    container.querySelectorAll('.game-score-edit').forEach(el => {
        bindScoreEditor(el, eventId, { autoSaveOnBlur: false });
    });

    container.querySelectorAll('.edit-score-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            editingCompletedScoreGameId = gameId;
            const card = container.querySelector(`.completed-game-card[data-game-id="${gameId}"]`);
            const display = card?.querySelector('.game-score')?.textContent || '0-0';
            const [t1, t2] = display.split('-').map(v => parseInt(v, 10) || 0);
            setGameLocalScore(gameId, t1, t2);
            container.querySelectorAll(`.game-score-row[data-game-id="${gameId}"]`).forEach(el => el.classList.add('hidden'));
            container.querySelectorAll(`.game-score-edit[data-game-id="${gameId}"]`).forEach(el => el.classList.remove('hidden'));
            card?.classList.add('is-editing-score');
            const discardBtn = container.querySelector(`.game-score-edit[data-game-id="${gameId}"] .score-icon-discard`);
            try { discardBtn?.focus(); } catch {}
        });
    });

    container.querySelectorAll('.save-score-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            const editRow = container.querySelector(`.game-score-edit[data-game-id="${gameId}"]`);
            const { score1, score2 } = readScorePairFromEditor(editRow, gameId);
            try {
                await api(`${API_BASE}/events/${eventId}/games/${gameId}/score`, {
                    method: 'POST',
                    body: JSON.stringify({ score_team1: score1, score_team2: score2 })
                });
                localGameScores.delete(gameId);
                editingCompletedScoreGameId = null;
                showToast('Score updated');
                loadEventDetail(eventId);
            } catch (err) {
                showToast(err.message);
            }
        });
    });

    container.querySelectorAll('.cancel-score-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            localGameScores.delete(gameId);
            editingCompletedScoreGameId = null;
            loadEventDetail(eventId);
        });
    });

    const completedGamesFilter = document.getElementById('completed-games-player-filter');
    if (completedGamesFilter) {
        completedGamesFilter.addEventListener('change', (e) => {
            currentCompletedGamesFilter = e.target.value;
            loadEventDetail(eventId);
        });
    }
}

async function scheduleGame(eventId) {
    try {
        const result = await api(`${API_BASE}/events/${eventId}/schedule`, { method: 'POST' });
        if (result.status === 'WAITING' && result.message) {
            showToast(result.message);
        } else if (result.id || result.game) {
            if (result.warning) {
                showToast(`Game scheduled — ${result.warning}`, { warning: true });
            } else {
                showToast('Game scheduled!');
            }
            loadEventDetail(eventId);
        } else if (result.message) {
            showToast(result.message);
        } else {
            showToast('Unexpected response');
        }
    } catch (err) {
        showToast(err.message);
    }
}

function openAddPlayersModal(eventId, selectedIds) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Add Players ${selectedIds.size > 0 ? `(${selectedIds.size} added)` : ''}</div>
                <button class="modal-close">&times;</button>
            </div>
            <div class="form-group">
                <label>Search / Add New</label>
                <input type="text" id="player-search" placeholder="Type name or DUPR ID, Enter to add" autocomplete="off">
            </div>
            <div id="available-players-list">Loading...</div>
            <button type="button" class="btn btn-primary mt-2" id="confirm-add-players">Add Selected</button>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    let allPlayers = [];
    let selected = new Set(selectedIds);
    let searchQuery = '';

    api(`${API_BASE}/players`).then(players => {
        allPlayers = players;
        renderPlayerCheckboxes();
    });

    function playerMatchesQuery(player, query) {
        if (!query) return true;
        const q = query.toLowerCase();
        if (player.name.toLowerCase().includes(q)) return true;
        if (player.duprId && String(player.duprId).toLowerCase().includes(q)) return true;
        return false;
    }

    function findExactPlayerMatch(query) {
        const q = query.trim().toLowerCase();
        if (!q) return null;
        return allPlayers.find(p =>
            p.name.trim().toLowerCase() === q ||
            (p.duprId && String(p.duprId).trim().toLowerCase() === q)
        ) || null;
    }

    function renderPlayerCheckboxes() {
        const container = document.getElementById('available-players-list');
        const filtered = allPlayers.filter(p => playerMatchesQuery(p, searchQuery));
        if (!allPlayers.length) {
            container.innerHTML = '<div class="text-muted">No players available. Type a name and press Enter to add.</div>';
            return;
        }
        if (!filtered.length) {
            container.innerHTML = '<div class="text-muted">No matching players. Press Enter to create a new one.</div>';
            return;
        }
        container.innerHTML = filtered.map(p => `
            <label class="player-checkbox-row">
                <input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
                <span>${escapeHtml(withDuprId(p.name, p))}</span>
            </label>
        `).join('');
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) selected.add(e.target.value);
                else selected.delete(e.target.value);
            });
        });
    }

    const searchInput = document.getElementById('player-search');
    searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.trim();
        renderPlayerCheckboxes();
    });

    searchInput.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const query = e.target.value.trim();
        if (!query) return;

        const existing = findExactPlayerMatch(query);
        if (existing) {
            selected.add(existing.id);
            e.target.value = '';
            searchQuery = '';
            renderPlayerCheckboxes();
            showToast(`Selected ${withDuprId(existing.name, existing)}`);
            return;
        }

        try {
            const player = await api(`${API_BASE}/players`, {
                method: 'POST',
                body: JSON.stringify({ name: query })
            });
            allPlayers.push(player);
            selected.add(player.id);
            e.target.value = '';
            searchQuery = '';
            renderPlayerCheckboxes();
        } catch (err) {
            // Name may already exist under a different casing; try selecting it.
            const fallback = findExactPlayerMatch(query) ||
                allPlayers.find(p => p.name.trim().toLowerCase() === query.toLowerCase());
            if (fallback) {
                selected.add(fallback.id);
                e.target.value = '';
                searchQuery = '';
                renderPlayerCheckboxes();
                showToast(`Selected ${withDuprId(fallback.name, fallback)}`);
            } else {
                showToast(err.message);
            }
        }
    });

    document.getElementById('confirm-add-players').addEventListener('click', async () => {
        const toAdd = Array.from(selected).filter(id => !selectedIds.has(id));
        if (!toAdd.length) {
            showToast('No new players selected');
            return;
        }
        try {
            await Promise.all(toAdd.map(playerId => api(`${API_BASE}/events/${eventId}/players`, {
                method: 'POST',
                body: JSON.stringify({ player_id: playerId })
            })));
            overlay.remove();
            showToast('Players added!');
            loadEventDetail(eventId);
        } catch (err) {
            showToast(err.message);
        }
    });
}

function renderPlayers() {
    app.innerHTML = `
        <div class="flex justify-between items-center mb-2">
            <h2 class="card-title">Players</h2>
            <div class="header-actions">
                <button class="btn btn-primary btn-sm" id="create-player-btn">+ New</button>
                ${isLoggedIn() ? '<button class="btn btn-secondary btn-sm" id="logout-btn">Logout</button>' : ''}
            </div>
        </div>
        <div id="players-list">Loading...</div>
    `;
    document.getElementById('create-player-btn').addEventListener('click', openCreatePlayerModal);
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('Logout? You will need to sign in again to access your events and players.')) {
                logout();
            }
        });
    }
    loadPlayersList();
}

async function loadPlayersList() {
    try {
        const players = await api(`${API_BASE}/players`);
        const container = document.getElementById('players-list');
        if (!players || !players.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128101;</div>
                    <p>No players yet. Create one to get started!</p>
                </div>`;
            return;
        }
        container.innerHTML = players.map(p => `
            <div class="list-item" data-player-id="${p.id}">
                <div style="flex:1">
                    <div class="list-item-title">${escapeHtml(p.name)}</div>
                    <div class="list-item-meta">${p.duprId ? `DUPR: ${escapeHtml(p.duprId)}` : 'No DUPR ID'}</div>
                </div>
                <span class="delete-link delete-player-btn" data-player-id="${p.id}">Delete</span>
            </div>
        `).join('');
        container.querySelectorAll('.list-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('delete-player-btn')) return;
                try {
                    const player = await api(`${API_BASE}/players/${item.dataset.playerId}`);
                    openEditPlayerModal(player);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });
        container.querySelectorAll('.delete-player-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const playerId = btn.dataset.playerId;
                if (!confirm('Delete this player? This cannot be undone.')) return;
                try {
                    await api(`${API_BASE}/players/${playerId}`, { method: 'DELETE' });
                    showToast('Player deleted');
                    loadPlayersList();
                } catch (err) {
                    showToast(err.message);
                }
            });
        });
    } catch (err) {
        app.innerHTML = `<div class="empty-state"><p class="text-danger">Failed to load players</p><p class="text-muted">${escapeHtml(err.message)}</p></div>`;
    }
}

function openCreatePlayerModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Create Player</div>
                <button class="modal-close">&times;</button>
            </div>
            <form id="create-player-form">
                <div class="form-group">
                    <label>Player Name</label>
                    <input type="text" name="name" required placeholder="Enter player name">
                </div>
                <div class="form-group">
                    <label>DUPR ID <span class="text-muted">(optional)</span></label>
                    <input type="text" name="duprId" placeholder="e.g. 1234567890" autocomplete="off">
                </div>
                <p id="create-player-error" class="auth-error hidden"></p>
                <button type="submit" class="btn btn-primary">Create Player</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const errorEl = document.getElementById('create-player-error');
    const showError = (msg) => {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
        showToast(msg);
    };
    document.getElementById('create-player-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.classList.add('hidden');
        const fd = new FormData(e.target);
        const name = String(fd.get('name') || '').trim();
        const duprId = String(fd.get('duprId') || '').trim();
        if (!name) return;
        try {
            const existing = await api(`${API_BASE}/players`);
            const duplicateName = existing.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (duplicateName) {
                showError(`Player "${name}" already exists. Use a different name.`);
                return;
            }
            if (duprId) {
                const duplicateDupr = existing.find(
                    p => p.duprId && String(p.duprId).toLowerCase() === duprId.toLowerCase()
                );
                if (duplicateDupr) {
                    showError(`DUPR ID "${duprId}" already exists on "${duplicateDupr.name}".`);
                    return;
                }
            }
            const body = { name };
            if (duprId) body.duprId = duprId;
            await api(`${API_BASE}/players`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            overlay.remove();
            loadPlayersList();
            showToast('Player created!');
        } catch (err) {
            showError(err.message);
        }
    });
}

function openEditPlayerModal(player) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Player Settings</div>
                <button class="modal-close">&times;</button>
            </div>
            <form id="edit-player-form">
                <div class="form-group">
                    <label>Player Name</label>
                    <input type="text" name="name" required placeholder="Enter player name">
                </div>
                <div class="form-group">
                    <label>DUPR ID <span class="text-muted">(optional)</span></label>
                    <input type="text" name="duprId" placeholder="e.g. 1234567890" autocomplete="off">
                </div>
                <p id="edit-player-error" class="auth-error hidden"></p>
                <button type="submit" class="btn btn-primary">Save Changes</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);
    const form = document.getElementById('edit-player-form');
    form.name.value = player.name || '';
    form.duprId.value = player.duprId || '';
    const errorEl = document.getElementById('edit-player-error');
    const showError = (msg) => {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
        showToast(msg);
    };
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.classList.add('hidden');
        const fd = new FormData(e.target);
        const name = String(fd.get('name') || '').trim();
        const duprId = String(fd.get('duprId') || '').trim();
        if (!name) return;
        try {
            const existing = await api(`${API_BASE}/players`);
            const duplicateName = existing.find(
                p => p.id !== player.id && p.name.toLowerCase() === name.toLowerCase()
            );
            if (duplicateName) {
                showError(`Player "${name}" already exists. Use a different name.`);
                return;
            }
            if (duprId) {
                const duplicateDupr = existing.find(
                    p => p.id !== player.id &&
                        p.duprId &&
                        String(p.duprId).toLowerCase() === duprId.toLowerCase()
                );
                if (duplicateDupr) {
                    showError(`DUPR ID "${duprId}" already exists on "${duplicateDupr.name}".`);
                    return;
                }
            }
            await api(`${API_BASE}/players/${player.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name, duprId })
            });
            overlay.remove();
            loadPlayersList();
            showToast('Player updated');
        } catch (err) {
            showError(err.message);
        }
    });
}

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function resolvePlayerName(playerId, status) {
    const player = status.players.find(p => p.id === playerId);
    if (player) return escapeHtml(player.name);
    return playerId.slice(0, 8);
}

function computePlayedWithMatrix(event) {
      const players = event.players || [];
      const gameHistory = event.gameHistory;

      if (!players.length) {
          return { playerIds: [], matrix: [], players: [] };
      }
  
      const nickNameMap = buildNickNameMap(players);
      
      const playerIds = players.map(p => p.id);
      const indexMap = new Map();
      playerIds.forEach((id, idx) => indexMap.set(id, idx));
  
      const n = playerIds.length;
      const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  
      for (const game of gameHistory) {
          const gamePlayers = [
              ...(game.players?.team1 || []),
              ...(game.players?.team2 || [])
          ];

          for (const p of gamePlayers) {
              const idxP = indexMap.get(p);
              if (idxP === undefined) continue;
              for (const q of gamePlayers) {
                  if (p === q) continue;
                  const idxQ = indexMap.get(q);
                  if (idxQ === undefined) continue;
                  matrix[idxP][idxQ]++;
              }
          }
      }
  
      // Sort playerIds by nickname and reorder matrix
      const sortedPlayerIds = [...playerIds].sort((a, b) => {
          const nickA = nickNameMap.get(a) || '';
          const nickB = nickNameMap.get(b) || '';
          return nickA.localeCompare(nickB);
      });
  
      const sortedIndexMap = new Map();
      sortedPlayerIds.forEach((id, idx) => sortedIndexMap.set(id, idx));
  
      const sortedMatrix = Array.from({ length: n }, () => Array(n).fill(0));
      for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
              const origIdI = playerIds[i];
              const origIdJ = playerIds[j];
              const newI = sortedIndexMap.get(origIdI);
              const newJ = sortedIndexMap.get(origIdJ);
              if (newI !== undefined && newJ !== undefined) {
                  sortedMatrix[newI][newJ] = matrix[i][j];
              }
          }
      }
  
      return { playerIds: sortedPlayerIds, matrix: sortedMatrix, players };
  }

function openManualAllotModal(eventId, courtId) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Manual Allotment - Court ${courtId}</div>
                <button class="modal-close">&times;</button>
            </div>
            <div class="manual-allot-form">
                <div class="team-section">
                    <div class="team-title">Team 1</div>
                    <div class="form-group">
                        <label>Player 1</label>
                        <select class="manual-allot-select" data-team="1" data-slot="0"></select>
                    </div>
                    <div class="form-group">
                        <label>Player 2 (optional)</label>
                        <select class="manual-allot-select partner-select" data-team="1" data-slot="1"></select>
                    </div>
                </div>
                <div class="team-divider"></div>
                <div class="team-section">
                    <div class="team-title">Team 2</div>
                    <div class="form-group">
                        <label>Player 1</label>
                        <select class="manual-allot-select" data-team="2" data-slot="0"></select>
                    </div>
                    <div class="form-group">
                        <label>Player 2 (optional)</label>
                        <select class="manual-allot-select partner-select" data-team="2" data-slot="1"></select>
                    </div>
                </div>
                <div id="manual-allot-error" class="manual-allot-error" style="display:none;"></div>
                <button type="button" class="btn btn-success" id="confirm-manual-allot">Confirm Allotment</button>
                <button type="button" class="btn btn-secondary mt-1" id="cancel-manual-allot">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    let currentEventId = eventId;
    let currentCourtId = courtId;

    api(`${API_BASE}/events/${eventId}/status`).then(status => {
        const waiting = status.players.filter(p => p.status === 'WAITING');
        const nickNameMap = buildNickNameMap(status.players);
        const selects = overlay.querySelectorAll('.manual-allot-select');

        function renderOptions(team, slot, excludeIds) {
            const select = overlay.querySelector(`.manual-allot-select[data-team="${team}"][data-slot="${slot}"]`);
            if (!select) return;
            const currentValue = select.value;
            const partnerId = overlay.querySelector(`.manual-allot-select[data-team="${team}"][data-slot="${slot === 0 ? 1 : 0}"]`)?.value;
            const available = waiting.filter(p => !excludeIds.has(p.id));

            let options = available.map(p => {
                const partnerIds = p.partnerIds || [];
                const hasPartnered = partnerId && partnerIds.includes(partnerId);
                const label = getPlayerLabel(p, nickNameMap);
                return { id: p.id, label, hasPartnered };
            });

            if (partnerId && slot === 1) {
                options.sort((a, b) => {
                    if (a.hasPartnered === b.hasPartnered) return 0;
                    return a.hasPartnered ? 1 : -1;
                });
            }

            select.innerHTML = '<option value="">-- Select Player --</option>' +
                options.map(o => {
                    if (o.hasPartnered) {
                        return `<option value="${o.id}" ${o.id === currentValue ? 'selected' : ''}>${o.label} ⚠️ Paired already</option>`;
                    }
                    return `<option value="${o.id}" ${o.id === currentValue ? 'selected' : ''}>${o.label}</option>`;
                }).join('');
        }

        selects.forEach(select => {
            const team = parseInt(select.dataset.team);
            const slot = parseInt(select.dataset.slot);
            const excludeIds = new Set(Array.from(selects).map(s => s.value).filter(Boolean));

            renderOptions(team, slot, excludeIds);

            select.addEventListener('change', () => {
                const allValues = Array.from(selects).map(s => s.value).filter(Boolean);
                selects.forEach(s => {
                    const otherIds = new Set([...allValues].filter(id => id !== s.value));
                    renderOptions(parseInt(s.dataset.team), parseInt(s.dataset.slot), otherIds);
                });
            });
        });
    });

    document.getElementById('cancel-manual-allot').addEventListener('click', () => overlay.remove());

    document.getElementById('confirm-manual-allot').addEventListener('click', async () => {
        const selects = overlay.querySelectorAll('.manual-allot-select');
        const team1Slots = [overlay.querySelector('.manual-allot-select[data-team="1"][data-slot="0"]'), overlay.querySelector('.manual-allot-select[data-team="1"][data-slot="1"]')];
        const team2Slots = [overlay.querySelector('.manual-allot-select[data-team="2"][data-slot="0"]'), overlay.querySelector('.manual-allot-select[data-team="2"][data-slot="1"]')];

        const team1 = team1Slots.map(s => s.value).filter(Boolean);
        const team2 = team2Slots.map(s => s.value).filter(Boolean);

        const errorEl = document.getElementById('manual-allot-error');
        const missing = [];
        if (team1.length + team2.length < 1) missing.push('Select at least 1 player');
        if (new Set([...team1, ...team2]).size !== team1.length + team2.length) missing.push('All players must be distinct');

        if (missing.length) {
            errorEl.textContent = missing.join(', ');
            errorEl.style.display = 'block';
            return;
        }
        errorEl.style.display = 'none';

        try {
            const res = await api(`${API_BASE}/events/${currentEventId}/courts/${currentCourtId}/allot-manual`, {
                method: 'POST',
                body: JSON.stringify({ team1, team2 })
            });
            if (res.warning) {
                showToast(`Court ${currentCourtId} manually allotted — ${res.warning}`, { warning: true });
            } else {
                showToast(`Court ${currentCourtId} manually allotted`);
            }
            overlay.remove();
            loadEventDetail(currentEventId);
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.style.display = 'block';
        }
    });
}

function buildShareLink(permission, token) {
    return `${window.location.origin}/?${permission}=${token}`;
}

function copyShareLink(link) {
    navigator.clipboard.writeText(link)
        .then(() => showToast('Link copied!'))
        .catch(err => {
            console.error('Clipboard copy failed:', err);
            const textarea = document.createElement('textarea');
            textarea.value = link;
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Link copied!');
            } catch (e) {
                showToast('Copy failed. Try pasting manually.');
            } finally {
                document.body.removeChild(textarea);
            }
        });
}

function setShareModalLink(permission, token, input, copyBtn, refreshBtn) {
    const link = buildShareLink(permission, token);
    input.value = link;
    input.disabled = false;
    copyBtn.disabled = false;
    refreshBtn.disabled = false;
    copyBtn.onclick = () => copyShareLink(link);
}

function openShareModal(eventId, permission) {
    const overlay = document.getElementById('share-modal');
    const title = document.getElementById('share-modal-title');
    const input = document.getElementById('share-link-input');
    const copyBtn = document.getElementById('copy-share-btn');
    const refreshBtn = document.getElementById('refresh-share-btn');
    const error = document.getElementById('share-error');
    if (!overlay) return;

    title.textContent = permission === 'moderator' ? 'Organize' : 'Share';
    input.value = 'Loading...';
    input.disabled = true;
    copyBtn.disabled = true;
    refreshBtn.disabled = true;
    error.classList.add('hidden');
    overlay.classList.add('active');

    const baseEndpoint = permission === 'moderator' ? '/invite-moderator' : '/share';

    const loadToken = () => api(`${API_BASE}/events/${eventId}${baseEndpoint}`, { method: 'POST' })
        .then(res => setShareModalLink(permission, res.token, input, copyBtn, refreshBtn))
        .catch(err => {
            input.value = 'Failed to load link';
            error.textContent = err.message;
            error.classList.remove('hidden');
            refreshBtn.disabled = false;
        });

    refreshBtn.onclick = () => {
        if (!confirm("'Refresh Link' will revoke any old links and permission. Continue?")) return;
        input.value = 'Refreshing...';
        input.disabled = true;
        copyBtn.disabled = true;
        refreshBtn.disabled = true;
        error.classList.add('hidden');
        api(`${API_BASE}/events/${eventId}${baseEndpoint}/refresh`, { method: 'POST' })
            .then(res => {
                setShareModalLink(permission, res.token, input, copyBtn, refreshBtn);
                showToast('New link created — old link revoked');
            })
            .catch(err => {
                input.value = 'Failed to refresh link';
                error.textContent = err.message;
                error.classList.remove('hidden');
                refreshBtn.disabled = false;
            });
    };

    loadToken();

    overlay.querySelector('.modal-close').onclick = closeShareModal;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeShareModal(); });
}

function closeShareModal() {
    const overlay = document.getElementById('share-modal');
    if (overlay) overlay.classList.remove('active');
}

// Initialize
(function parseAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        localStorage.setItem('gm_token', urlToken);
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('token');
        window.history.replaceState({}, '', newUrl.toString());
    }
})();

initWelcomeScreen();
