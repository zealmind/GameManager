const API_BASE = (window.__API_BASE__ && window.__API_BASE__.replace(/\/$/, '')) || window.location.origin;
let currentEventId = null;
const deadlockCourtErrors = new Map();
let currentCompletedGamesFilter = '';
let currentUser = null;

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

function showToast(msg) {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

async function api(url, options = {}) {
    const token = getToken();
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 6000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            signal: controller.signal,
            ...options
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            if (res.status === 401) {
                clearUser();
                showLoginModal();
            }
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
    currentEventId = null;
    if (view === 'dashboard') {
        renderDashboard();
    } else if (view === 'events') {
        renderEvents();
    } else if (view === 'players') {
        renderPlayers();
    }
}

function initWelcomeScreen() {
    const screen = document.getElementById('welcome-screen');
    const video = document.getElementById('welcome-video');
    const btn = document.getElementById('enter-btn');
    const debug = document.getElementById('auth-debug');

    if (!screen || !video || !btn) return;

    console.log('[welcome] init start', { API_BASE, hasToken: !!getToken() });

    video.muted = true;
    video.volume = 0;
    video.play().catch(() => {
        console.log('[welcome] video autoplay blocked');
        btn.textContent = '▶ Play & Enter';
    });

    checkAuthState();

    btn.onclick = () => {
        console.log('[welcome] button clicked', { isLoggedIn: isLoggedIn() });
        screen.classList.remove('active');
        video.pause();
        if (isLoggedIn()) {
            switchView('dashboard');
        } else {
            showLoginModal();
        }
    };
}

function setDebug(msg) {
    const debug = document.getElementById('auth-debug');
    if (!debug) return;
    debug.textContent = msg;
    console.log('[auth-debug]', msg);
}

async function checkAuthState() {
    const btn = document.getElementById('enter-btn');
    const debug = document.getElementById('auth-debug');
    if (!btn) return;

    const token = getToken();
    console.log('[auth] check start', { token: !!token, API_BASE });

    if (!token) {
        console.log('[auth] no token -> Login/Sign Up');
        btn.textContent = 'Login / Sign Up';
        setDebug('No session found');
        return;
    }

    if (!API_BASE || API_BASE === 'null') {
        console.log('[auth] no API_BASE -> Login/Sign Up');
        btn.textContent = 'Login / Sign Up';
        setDebug('Cannot connect — open via http://localhost:4444');
        return;
    }

    try {
        setDebug('Verifying session...');
        console.log('[auth] calling /auth/me at', `${API_BASE}/auth/me`);
        const user = await api(`${API_BASE}/auth/me`, { timeoutMs: 4000 });
        console.log('[auth] session valid', user.user.name);
        setUser(user.user);
        btn.textContent = 'Enter Site';
        setDebug(`Logged in as ${user.user.name}`);
    } catch (err) {
        console.warn('[auth] session check failed:', err.message);
        clearUser();
        btn.textContent = 'Login / Sign Up';
        setDebug(`Session invalid: ${err.message}`);
    }
}

function logout() {
    clearUser();
    switchView('dashboard');
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

    try {
        await api(`${API_BASE}/auth/me`, { method: 'GET', timeoutMs: 4000 });
    } catch {
        // not logged in — modal is ready for login/signup
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

function loadEventsList() {

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
        const events = await api(`${API_BASE}/events`);
        const container = document.getElementById('events-list');
        if (!events || !events.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128197;</div>
                    <p>No events yet. Create one to get started!</p>
                </div>`;
            return;
        }
        container.innerHTML = events.map(e => `
            <div class="list-item" data-event-id="${e.id}">
                <div style="flex:1">
                    <div class="list-item-title">${escapeHtml(e.name)}</div>
                    <div class="list-item-meta">ID: ${e.id.slice(0,8)}... | ${e.totalGamesToPlay} games | ${e.courts || 0} courts</div>
                </div>
                <button class="btn btn-danger btn-sm delete-event-btn" data-event-id="${e.id}">Delete</button>
            </div>
        `).join('');
        container.querySelectorAll('.list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('delete-event-btn')) return;
                openEventDetail(item.dataset.eventId);
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
                    <input type="number" name="totalGamesToPlay" required min="1" value="18">
                </div>
                <div class="form-group">
                    <label>Number of Courts</label>
                    <input type="number" name="numCourts" required min="1" value="3">
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

async function openEventDetail(eventId) {
    currentEventId = eventId;
    navBtns.forEach(b => b.classList.remove('active'));
    app.innerHTML = `
        <div class="app-header">
            ${showBackButton()}
            <h1>Event Detail</h1>
        </div>
        <div id="event-detail">Loading...</div>
    `;
    document.getElementById('back-btn').addEventListener('click', () => switchView('dashboard'));
    await loadEventDetail(eventId);
}

async function loadEventDetail(eventId) {
    try {
        const [event, status] = await Promise.all([
            api(`${API_BASE}/events/${eventId}`),
            api(`${API_BASE}/events/${eventId}/status`)
        ]);

        const container = document.getElementById('event-detail');
        if (!container) return;

        const activeGames = (event.games || []).filter(g => !g.completed);
        const completedGames = event.gameHistory || [];

        let phaseHtml = '';
        if (!status.isStarted) {
            phaseHtml = renderRegistrationPhase(event, status);
        } else {
            phaseHtml = renderGamePhase(event, status, activeGames, completedGames);
        }

        container.innerHTML = phaseHtml;
        bindEventDetailActions(eventId, event, status);
    } catch (err) {
        app.innerHTML = `<div class="empty-state"><p class="text-danger">Failed to load event</p><p class="text-muted">${escapeHtml(err.message)}</p></div>`;
    }
}

function renderRegistrationPhase(event, status) {
    return `
        <div class="card">
            <div class="card-title">${escapeHtml(event.name)}</div>
            <div class="card-subtitle">Registration Phase — Add players before starting</div>
        </div>

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
                            <div class="player-name">${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</div>
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

function renderGamePhase(event, status, activeGames, completedGames) {
    const maxCourt = event.courts || 1;
    let courtsHtml = '';
    status.courts.forEach(court => {
        const deadlockError = deadlockCourtErrors.get(court.courtId);
        courtsHtml += `<div class="court-card" data-court-id="${court.courtId}">
            <div class="court-row">
                <div class="court-header">Court ${court.courtId}</div>
                <div class="court-status">
                    ${court.game && court.game.started ? '<span class="text-muted">In Progress</span>' : ''}
                    ${court.game && !court.game.started ? '<span class="text-muted">Allotted</span>' : ''}
                    ${!court.game ? '<span class="text-muted">Available</span>' : ''}
                    ${!court.game && !deadlockError ? `
                        <button class="btn btn-primary btn-sm manual-allot-btn" data-court-id="${court.courtId}">Manual Allot</button>
                        <button class="btn btn-primary btn-sm allot-btn" data-court-id="${court.courtId}">Auto Allot</button>
                    ` : ''}
                </div>
            </div>
            <div class="court-msg" style="display: ${deadlockError ? 'block' : 'none'}">${deadlockError ? escapeHtml(deadlockError) : ''}</div>`;
        if (court.game && !court.game.started) {
            const g = court.game;
            const team1Names = g.team1.map(p => escapeHtml(p.name)).join(', ');
            const team2Names = g.team2.map(p => escapeHtml(p.name)).join(', ');
            courtsHtml += `
                <div class="game-card court-game-card" data-game-id="${g.id}">
                    <div class="game-teams">
                        <div class="game-team">Team 1: ${team1Names}</div>
                        <div class="game-team">Team 2: ${team2Names}</div>
                        <div class="game-status status-scheduled">Allotted - Ready to start</div>
                    </div>
                    <button class="btn btn-success btn-sm start-game-btn mt-1" data-game-id="${g.id}">Start Game</button>
                </div>
                <button class="btn btn-secondary btn-sm cancel-allot-btn mt-1" data-court-id="${court.courtId}">Cancel Allotment</button>
            `;
        } else if (court.game && court.game.started) {
            const g = court.game;
            const team1Names = g.team1.map(p => escapeHtml(p.name)).join(', ');
            const team2Names = g.team2.map(p => escapeHtml(p.name)).join(', ');
            courtsHtml += `
                <div class="game-card court-game-card" data-game-id="${g.id}">
                    <div class="game-teams">
                        <div class="game-team">Team 1: ${team1Names}</div>
                        <div class="game-team">Team 2: ${team2Names}</div>
                        <div class="game-status status-playing">In Progress</div>
                    </div>
                    <div class="court-scores">
                        <div class="score-input-group">
                            <input type="number" class="score-input" data-game-id="${g.id}" data-team="1" value="${g.scores ? g.scores[0] : 0}" min="0">
                            <span class="score-vs">-</span>
                            <input type="number" class="score-input" data-game-id="${g.id}" data-team="2" value="${g.scores ? g.scores[1] : 0}" min="0">
                        </div>
                        <button class="btn btn-success btn-sm mt-1 end-game-btn" data-game-id="${g.id}">End Game</button>
                    </div>
                </div>
            `;
        }
        courtsHtml += `</div>`;
    });

    const waiting = status.players.filter(p => p.status === 'WAITING');
    const playing = status.players.filter(p => p.status === 'PLAYING');
    const away = status.players.filter(p => p.status === 'AWAY');
    const retired = status.players.filter(p => p.status === 'RETIRED');

    const renderPlayerGroup = (title, players, showActions) => {
        if (!players.length) return '';
        return `
            <div class="player-group">
                <div class="card-subtitle" style="font-weight:600; margin-bottom:4px; cursor:pointer;" onclick="togglePlayerGroup(this)">${title} (${players.length}) &#9662;</div>
                <div class="player-group-content">
                    ${players.map(p => `
                        <div class="player-row">
                            <div class="player-info">
                                <div class="player-name">${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</div>
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
            <div class="card-title">${escapeHtml(event.name)}</div>
            <div class="card-subtitle">Started ${status.startedAt ? new Date(status.startedAt).toLocaleString() : ''}</div>
        </div>

        <div class="card">
            <div class="card-title" style="font-size:16px;">Leaderboard</div>
            <div id="leaderboard-list">
                ${renderLeaderboard(status, completedGames)}
            </div>
        </div>

        <div class="card">
            <div class="card-subtitle mb-2">Game Field</div>
            ${courtsHtml}
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-2">
                <div class="card-title" style="font-size:16px; cursor:pointer;" id="players-toggle">Players &#9662;</div>
                ${!status.isStarted ? `<button class="btn btn-primary btn-sm" id="add-players-btn">+ Add Players</button>` : ''}
            </div>
            <div id="players-list" class="${status.isStarted ? 'players-section-collapsed' : ''}">
                ${renderPlayerGroup('Waiting', waiting, true)}
                ${renderPlayerGroup('Playing', playing, false)}
                ${renderPlayerGroup('Away', away, true)}
                ${renderPlayerGroup('Retired', retired, false)}
            </div>
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-2">
                <div class="card-title" style="font-size:16px; cursor:pointer;" id="completed-games-toggle">Completed Games &#9662;</div>
                <select id="completed-games-player-filter" class="player-filter-select">
                    <option value="">All Players</option>
                    ${status.players.map(p => `<option value="${p.id}" ${currentCompletedGamesFilter === p.id ? 'selected' : ''}>${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</option>`).join('')}
                </select>
            </div>
            <div id="completed-games-list">
                ${completedGames.length ? completedGames.filter(g => {
                    if (!currentCompletedGamesFilter) return true;
                    return (g.players.team1 || []).includes(currentCompletedGamesFilter) || (g.players.team2 || []).includes(currentCompletedGamesFilter);
                }).map(g => `
                    <div class="game-card completed-game-card" data-game-id="${g.id}">
                        <div class="game-teams">
                            <div class="game-team">Team 1: ${g.players.team1.map(id => resolvePlayerName(id, status)).join(', ')}</div>
                            <div class="game-team">Team 2: ${g.players.team2.map(id => resolvePlayerName(id, status)).join(', ')}</div>
                            <div class="game-status status-completed">Completed</div>
                            <div class="game-meta">
                                court ${g.courtId} | ${g.startedAt ? `Start: ${new Date(g.startedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : ''}
                                ${g.completedAt ? ` | End: ${new Date(g.completedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : ''}
                                ${g.startedAt && g.completedAt ? ` | Duration: ${formatDuration(new Date(g.completedAt).getTime() - new Date(g.startedAt).getTime())}` : ''}
                            </div>
                        </div>
                        <div class="game-score-side">
                            <div class="game-score-row" data-game-id="${g.id}">
                                <span class="game-score">${g.scores?.[0] || 0}-${g.scores?.[1] || 0}</span>
                                <button class="btn btn-secondary btn-sm edit-score-btn" data-game-id="${g.id}">Edit Score</button>
                            </div>
                            <div class="game-score-edit hidden" data-game-id="${g.id}">
                                <div class="score-input-group">
                                    <input type="number" class="score-input" data-game-id="${g.id}" data-team="1" value="${g.scores ? g.scores[0] : 0}" min="0">
                                    <span class="score-vs">-</span>
                                    <input type="number" class="score-input" data-game-id="${g.id}" data-team="2" value="${g.scores ? g.scores[1] : 0}" min="0">
                                </div>
                                <button class="btn btn-success btn-sm mt-2 save-score-btn" data-game-id="${g.id}">Save</button>
                                <button class="btn btn-secondary btn-sm mt-2 cancel-score-btn" data-game-id="${g.id}">Cancel</button>
                            </div>
                        </div>
                    </div>
                `).join('') : '<div class="text-muted">No completed games yet</div>'}
            </div>
        </div>
    `;
}

function getPlayerActionButtons(player) {
    if (player.status === 'WAITING') {
        return `
            <button class="btn btn-warning btn-sm status-action-btn" data-player-id="${player.id}" data-status="AWAY">Take Break</button>
            <button class="btn btn-danger btn-sm status-action-btn" data-player-id="${player.id}" data-status="RETIRED">Retire</button>
        `;
    } else if (player.status === 'AWAY') {
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
    const score1 = 11 + Math.floor(Math.random() * 6); // 11-16
    const max2 = Math.max(0, score1 - 2);
    const score2 = Math.floor(Math.random() * (max2 + 1)); // 0 to max2
    return [score1, score2];
}

function renderLeaderboard(status, completedGames) {
    if (!status.players || !status.players.length) {
        return '<div class="text-muted">No players yet</div>';
    }

    const stats = {};
    for (const p of status.players) {
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

    const sorted = [...status.players].sort((a, b) => {
        const wa = stats[a.id]?.wins || 0;
        const wb = stats[b.id]?.wins || 0;
        if (wb !== wa) return wb - wa;
        const da = stats[a.id]?.scoreDiff || 0;
        const db = stats[b.id]?.scoreDiff || 0;
        return db - da;
    });

    return `
        <div class="leaderboard">
            ${sorted.map((p, idx) => {
                const s = stats[p.id] || { wins: 0, scoreDiff: 0 };
                const diffStr = s.scoreDiff > 0 ? `+${s.scoreDiff}` : `${s.scoreDiff}`;
                const partnersStr = (p.partners || []).map(nick => escapeHtml(nick)).join(', ') || 'None';
                return `
                <div class="leaderboard-row">
                    <div class="leaderboard-rank">${idx + 1}</div>
                    <div class="leaderboard-player">
                        <div class="player-name">${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</div>
                        <div class="player-meta">Games: ${p.gamesPlayed} | Partners: ${partnersStr}</div>
                    </div>
                    <div class="leaderboard-stat">${s.wins} <span class="text-muted">wins</span></div>
                    <div class="leaderboard-stat">${diffStr} <span class="text-muted">diff</span></div>
                </div>
            `;
            }).join('')}
        </div>
    `;
}

function bindEventDetailActions(eventId, event, status) {
    const container = document.getElementById('event-detail');
    if (!container) return;

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
                        showToast(`Court ${courtId}: ${res.message}`);
                        loadEventDetail(eventId);
                    } else {
                        deadlockCourtErrors.delete(courtId);
                        showToast(`Court ${courtId} allotted`);
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
                    showToast('Game ended!');
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                }
            });
        });

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

    container.querySelectorAll('.edit-score-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            container.querySelectorAll(`.game-score-row[data-game-id="${gameId}"]`).forEach(el => el.classList.add('hidden'));
            container.querySelectorAll(`.game-score-edit[data-game-id="${gameId}"]`).forEach(el => el.classList.remove('hidden'));
        });
    });

    container.querySelectorAll('.save-score-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const gameId = btn.dataset.gameId;
            const editRow = container.querySelector(`.game-score-edit[data-game-id="${gameId}"]`);
            const inputs = editRow.querySelectorAll('.score-input');
            const score1 = parseInt(inputs[0].value) || 0;
            const score2 = parseInt(inputs[1].value) || 0;
            try {
                await api(`${API_BASE}/events/${eventId}/games/${gameId}/score`, {
                    method: 'POST',
                    body: JSON.stringify({ score_team1: score1, score_team2: score2 })
                });
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
            container.querySelectorAll(`.game-score-row[data-game-id="${gameId}"]`).forEach(el => el.classList.remove('hidden'));
            container.querySelectorAll(`.game-score-edit[data-game-id="${gameId}"]`).forEach(el => el.classList.add('hidden'));
        });
    });

    const completedGamesList = document.getElementById('completed-games-list');
    const completedGamesToggle = document.getElementById('completed-games-toggle');
    if (completedGamesList && completedGamesToggle) {
        completedGamesList.classList.add('completed-games-collapsed');
        completedGamesToggle.addEventListener('click', () => {
            const isCollapsed = completedGamesList.classList.toggle('completed-games-collapsed');
            completedGamesToggle.innerHTML = `Completed Games ${isCollapsed ? '&#9662;' : '&#9652;'}`;
        });
    }

    const completedGamesFilter = document.getElementById('completed-games-player-filter');
    if (completedGamesFilter) {
        completedGamesFilter.addEventListener('change', (e) => {
            currentCompletedGamesFilter = e.target.value;
            loadEventDetail(eventId);
        });
    }

    const playersList = document.getElementById('players-list');
    const playersToggle = document.getElementById('players-toggle');
    if (playersList && playersToggle) {
        playersToggle.addEventListener('click', () => {
            const isCollapsed = playersList.classList.toggle('players-section-collapsed');
            playersToggle.innerHTML = `Players ${isCollapsed ? '&#9662;' : '&#9652;'}`;
        });
    }
}

async function scheduleGame(eventId) {
    try {
        const result = await api(`${API_BASE}/events/${eventId}/schedule`, { method: 'POST' });
        if (result.message) {
            showToast(result.message);
        } else if (result.game) {
            showToast('Game scheduled!');
            loadEventDetail(eventId);
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
                <div class="modal-title">Add Players</div>
                <button class="modal-close">&times;</button>
            </div>
            <div class="form-group">
                <label>Search / Add New</label>
                <input type="text" id="player-search" placeholder="Type name and press Enter to add">
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

    api(`${API_BASE}/players`).then(players => {
        allPlayers = players;
        renderPlayerCheckboxes();
    });

    function renderPlayerCheckboxes() {
        const container = document.getElementById('available-players-list');
        if (!allPlayers.length) {
            container.innerHTML = '<div class="text-muted">No players available. Add one below.</div>';
            return;
        }
        container.innerHTML = allPlayers.map(p => `
            <label class="player-checkbox-row">
                <input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}>
                <span>${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</span>
            </label>
        `).join('');
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) selected.add(e.target.value);
                else selected.delete(e.target.value);
            });
        });
    }

    document.getElementById('player-search').addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const name = e.target.value.trim();
            if (!name) return;
            try {
                const player = await api(`${API_BASE}/players`, {
                    method: 'POST',
                    body: JSON.stringify({ name })
                });
                allPlayers.push(player);
                selected.add(player.id);
                renderPlayerCheckboxes();
                e.target.value = '';
            } catch (err) {
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
            <button class="btn btn-primary btn-sm" id="create-player-btn">+ New</button>
        </div>
        <div id="players-list">Loading...</div>
    `;
    document.getElementById('create-player-btn').addEventListener('click', openCreatePlayerModal);
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
                    <div class="list-item-title">${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</div>
                    <div class="list-item-meta">ID: ${p.id.slice(0,8)}...</div>
                </div>
                <button class="btn btn-danger btn-sm delete-player-btn" data-player-id="${p.id}">Delete</button>
            </div>
        `).join('');
        container.querySelectorAll('.list-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('delete-player-btn')) return;
                try {
                    const player = await api(`${API_BASE}/players/${item.dataset.playerId}`);
                    showToast(`${player.name} (ID: ${player.id.slice(0,8)}...)`);
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
                <button type="submit" class="btn btn-primary">Create Player</button>
            </form>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('create-player-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
            await api(`${API_BASE}/players`, {
                method: 'POST',
                body: JSON.stringify({ name: fd.get('name') })
            });
            overlay.remove();
            loadPlayersList();
            showToast('Player created!');
        } catch (err) {
            showToast(err.message);
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
                        <label>Player 2 (Partner)</label>
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
                        <label>Player 2 (Partner)</label>
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
                const label = escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name);
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

        const team1 = [team1Slots[0].value, team1Slots[1].value];
        const team2 = [team2Slots[0].value, team2Slots[1].value];

        const errorEl = document.getElementById('manual-allot-error');
        const missing = [];
        if (!team1[0] || !team1[1]) missing.push('Team 1 needs 2 players');
        if (!team2[0] || !team2[1]) missing.push('Team 2 needs 2 players');
        if (new Set([...team1, ...team2].filter(Boolean)).size !== 4) missing.push('All 4 players must be distinct');

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
            showToast(`Court ${currentCourtId} manually allotted`);
            overlay.remove();
            loadEventDetail(currentEventId);
        } catch (err) {
            errorEl.textContent = err.message;
            errorEl.style.display = 'block';
        }
    });
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
