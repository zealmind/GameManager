const API_BASE = window.location.origin;
let currentEventId = null;

const app = document.getElementById('main-content');
const navBtns = document.querySelectorAll('.nav-btn');

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
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

function switchView(view) {
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'events') {
        currentEventId = null;
        renderEvents();
    } else if (view === 'players') {
        currentEventId = null;
        renderPlayers();
    }
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
                    <label>Total Games to Play</label>
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
        try {
            await api(`${API_BASE}/events`, {
                method: 'POST',
                body: JSON.stringify({
                    name: fd.get('name'),
                    totalGamesToPlay: parseInt(fd.get('totalGamesToPlay')),
                    numCourts: parseInt(fd.get('numCourts'))
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
    document.getElementById('back-btn').addEventListener('click', () => switchView('events'));
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
                            <div class="player-meta">Games: ${p.gamesPlayed} | Partners: ${(p.partners || []).map(nick => escapeHtml(nick)).join(', ') || 'None'}</div>
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
        courtsHtml += `<div class="court-card">
            <div class="court-header">Court ${court.courtId}</div>`;
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
        } else {
            courtsHtml += `
                <div class="text-muted" style="margin-bottom:8px;">Available</div>
                <button class="btn btn-primary btn-sm allot-btn" data-court-id="${court.courtId}">Allot Players</button>
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
                                <div class="player-meta">Games: ${p.gamesPlayed} | Partners: ${(p.partners || []).map(nick => escapeHtml(nick)).join(', ') || 'None'}</div>
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
                <div class="card-title" style="font-size:16px;">Players</div>
                <button class="btn btn-primary btn-sm" id="add-players-btn">+ Add Players</button>
            </div>
            ${renderPlayerGroup('Waiting', waiting, true)}
            ${renderPlayerGroup('Playing', playing, false)}
            ${renderPlayerGroup('Away', away, true)}
            ${renderPlayerGroup('Retired', retired, false)}
        </div>

        <div class="card">
            <div class="flex justify-between items-center mb-2">
                <div class="card-title" style="font-size:16px; cursor:pointer;" id="completed-games-toggle">Completed Games &#9662;</div>
            </div>
            <div id="completed-games-list">
                ${completedGames.length ? completedGames.map(g => `
                    <div class="game-card completed-game-card" data-game-id="${g.id}">
                        <div class="game-teams">
                            <div class="game-team">Team 1: ${g.players.team1.map(id => resolvePlayerName(id, status)).join(', ')}</div>
                            <div class="game-team">Team 2: ${g.players.team2.map(id => resolvePlayerName(id, status)).join(', ')}</div>
                            <div class="game-status status-completed">Completed</div>
                            <div class="game-meta">
                                ${g.startedAt ? `Start: ${new Date(g.startedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : ''}
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
            <button class="btn btn-warning btn-sm status-action-btn" data-player-id="${player.id}" data-status="AWAY">Away</button>
            <button class="btn btn-danger btn-sm status-action-btn" data-player-id="${player.id}" data-status="RETIRED">Retire</button>
        `;
    } else if (player.status === 'AWAY') {
        return `<button class="btn btn-success btn-sm status-action-btn" data-player-id="${player.id}" data-status="WAITING">Come Back</button>`;
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
                return `
                <div class="leaderboard-row">
                    <div class="leaderboard-rank">${idx + 1}</div>
                    <div class="leaderboard-player">
                        <div class="player-name">${escapeHtml((p.nickName ? p.nickName + '. ' : '') + p.name)}</div>
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
                    showToast(`Court ${courtId} allotted`);
                    loadEventDetail(eventId);
                } catch (err) {
                    showToast(err.message);
                    btn.disabled = false;
                    btn.textContent = 'Allot Players';
                }
            });
        });

        container.querySelectorAll('.cancel-allot-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const courtId = btn.dataset.courtId;
                try {
                    await api(`${API_BASE}/events/${eventId}/courts/${courtId}/allot`, { method: 'DELETE' });
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
                const score1 = parseInt(inputs[0].value) || 0;
                const score2 = parseInt(inputs[1].value) || 0;
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

// Initialize
switchView('events');
