/**
 * app.js
 * Universal Client-Side Real-Time Gamepad & Host Controller for Quiz Battle Arena.
 * Features built-in Web Audio synthesis and zero-dependency Canvas Confetti.
 */

// Initialize Socket.io Connection
const socket = io();

// Application State
let currentPin = null;
let currentRole = null; // 'host' or 'player'
let currentPlayerName = null;
let currentTotalScore = 0;
let questionStartTime = null;
let hasAnsweredCurrentQuestion = false;
let hostTimerInterval = null;
let playerTimerInterval = null;
let lastAnswerFeedback = null;

// ============================================================================
// 🔊 Synthesized Web Audio Sound Effects (Zero External Asset Dependencies)
// ============================================================================
const audioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
  ? new (window.AudioContext || window.webkitAudioContext)()
  : null;

function playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1) {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    // Audio auto-play policies or unsupported context
  }
}

const SoundFX = {
  click: () => playTone(600, 'triangle', 0.08, 0.1),
  countdown: () => playTone(440, 'sine', 0.1, 0.05),
  start: () => {
    playTone(523.25, 'sine', 0.12, 0.1); // C5
    setTimeout(() => playTone(659.25, 'sine', 0.12, 0.1), 100); // E5
    setTimeout(() => playTone(783.99, 'sine', 0.25, 0.12), 200); // G5
  },
  correct: () => {
    playTone(587.33, 'triangle', 0.15, 0.15); // D5
    setTimeout(() => playTone(880.00, 'triangle', 0.35, 0.2), 150); // A5
  },
  wrong: () => {
    playTone(220, 'sawtooth', 0.25, 0.15);
    setTimeout(() => playTone(180, 'sawtooth', 0.3, 0.15), 180);
  },
  fanfare: () => {
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 'triangle', 0.35, 0.2), idx * 160);
    });
  }
};

// ============================================================================
// 🎉 Canvas Confetti Particle System (Zero External Library)
// ============================================================================
function launchConfetti(durationMs = 4000) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ffffff'];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * 80 + 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.floor(Math.random() * 10) - 10,
      tiltAngleInc: Math.random() * 0.07 + 0.05,
      tiltAngle: 0
    });
  }

  const startTime = Date.now();
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.tiltAngle += p.tiltAngleInc;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.x += Math.sin(p.d);
      p.tilt = Math.sin(p.tiltAngle) * 15;

      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
      ctx.stroke();
    });

    if (Date.now() - startTime < durationMs) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  draw();
}

// ============================================================================
// 👑 HOST SCREEN CONTROLLER & EVENT LISTENERS
// ============================================================================

function initHostScreen() {
  currentRole = 'host';
  console.log('[App] Initialized Host Dashboard Controller.');
}

/**
 * Host submits form to create room and generate 4-digit PIN
 */
function handleHostCreateRoom(e) {
  if (e) e.preventDefault();
  SoundFX.click();

  const hostName = document.getElementById('host-name-input').value.trim() || 'Host';
  const category = document.getElementById('category-select').value;

  socket.emit('quiz:create', { hostName, category });
}

/**
 * Host clicks "Start Game" to begin countdown & questions
 */
function handleHostStartGame() {
  if (!currentPin) return;
  SoundFX.click();
  socket.emit('quiz:start', { pin: currentPin });
}

// Host Event: Room Created
socket.on('quiz:created', ({ pin, roomId }) => {
  currentPin = pin;
  console.log(`[Host] Quiz Room Created: PIN ${pin} (Room ID: ${roomId})`);

  // Switch from setup view to lobby view
  const setupView = document.getElementById('view-host-setup');
  const lobbyView = document.getElementById('view-host-lobby');
  if (setupView && lobbyView) {
    setupView.style.display = 'none';
    lobbyView.style.display = 'block';
  }

  // Update PIN display in lobby and header
  const pinDisplay = document.getElementById('lobby-pin-display');
  if (pinDisplay) pinDisplay.textContent = pin;

  const headerPin = document.getElementById('room-pin-header-display');
  const headerPinText = document.getElementById('pin-header-text');
  if (headerPin && headerPinText) {
    headerPin.style.display = 'block';
    headerPinText.textContent = pin;
  }

  const statusBadge = document.getElementById('host-status-badge');
  if (statusBadge) statusBadge.textContent = 'LOBBY OPEN';
});

// Shared Event: Lobby Roster Updated
socket.on('lobby:update', ({ players }) => {
  console.log('[Lobby] Roster update received:', players);

  if (currentRole === 'host') {
    const listContainer = document.getElementById('lobby-players-list');
    const countBadge = document.getElementById('lobby-player-count');
    const startBtn = document.getElementById('btn-start-game');
    const startBtnCount = document.getElementById('start-btn-count');

    if (listContainer) {
      if (!players || players.length === 0) {
        listContainer.innerHTML = `
          <p id="empty-lobby-notice" style="color: #64748b; font-size: 0.95rem; margin: auto;">
            Waiting for players to enter PIN and join...
          </p>
        `;
      } else {
        listContainer.innerHTML = players.map(p => `
          <div class="player-tag">
            <div class="player-avatar-circle">🎮</div>
            <span>${p.name}</span>
          </div>
        `).join('');
      }
    }

    const activeCount = players ? players.length : 0;
    if (countBadge) countBadge.textContent = `${activeCount} Joined`;
    if (startBtnCount) startBtnCount.textContent = activeCount;
    if (startBtn) {
      startBtn.disabled = activeCount === 0;
    }
  }
});

// Shared Event: Live Submission Tally on Host Screen
socket.on('answer:count_update', ({ answeredCount, totalPlayers }) => {
  if (currentRole === 'host') {
    const tallyEl = document.getElementById('host-answer-tally');
    if (tallyEl) {
      tallyEl.textContent = `${answeredCount} / ${totalPlayers} Answered`;
    }
  }
});

// Shared Event: Question Start
socket.on('question:start', ({ questionIndex, totalQuestions, question, options, timeLimitSeconds }) => {
  console.log(`[Game] Question ${questionIndex}/${totalQuestions} started: "${question}"`);
  SoundFX.start();

  questionStartTime = Date.now();
  hasAnsweredCurrentQuestion = false;
  lastAnswerFeedback = null;

  // --- HOST VIEW HANDLING ---
  if (currentRole === 'host') {
    // Hide other views, show Question arena
    hideHostViews();
    const qArena = document.getElementById('view-host-question');
    if (qArena) qArena.style.display = 'block';

    const statusBadge = document.getElementById('host-status-badge');
    if (statusBadge) statusBadge.textContent = `Q ${questionIndex}/${totalQuestions}`;

    // Fill Question Data
    document.getElementById('host-q-current').textContent = questionIndex;
    document.getElementById('host-q-total').textContent = totalQuestions;
    document.getElementById('host-question-text').textContent = question;

    // Reset Answer Cards
    const explanationCard = document.getElementById('host-explanation-card');
    if (explanationCard) explanationCard.style.display = 'none';

    options.forEach((optText, idx) => {
      const card = document.getElementById(`host-opt-${idx}`);
      const textEl = document.getElementById(`host-opt-text-${idx}`);
      if (card && textEl) {
        textEl.textContent = optText;
        card.classList.remove('correct-highlight', 'dimmed');
      }
    });

    // Start 15s Host Visual Countdown
    let timeLeft = timeLimitSeconds || 15;
    const timerCircle = document.getElementById('host-timer-circle');
    const timerBar = document.getElementById('host-timer-bar');

    if (timerCircle) {
      timerCircle.textContent = timeLeft;
      timerCircle.classList.remove('warning');
    }
    if (timerBar) {
      timerBar.style.transition = 'none';
      timerBar.style.width = '100%';
      setTimeout(() => {
        timerBar.style.transition = `width ${timeLeft}s linear`;
        timerBar.style.width = '0%';
      }, 50);
    }

    if (hostTimerInterval) clearInterval(hostTimerInterval);
    hostTimerInterval = setInterval(() => {
      timeLeft--;
      if (timerCircle) {
        timerCircle.textContent = Math.max(0, timeLeft);
        if (timeLeft <= 5) {
          timerCircle.classList.add('warning');
          SoundFX.countdown();
        }
      }
      if (timeLeft <= 0) {
        clearInterval(hostTimerInterval);
      }
    }, 1000);
  }

  // --- PLAYER VIEW HANDLING ---
  if (currentRole === 'player') {
    hidePlayerViews();
    const gamepadView = document.getElementById('view-player-gamepad');
    if (gamepadView) gamepadView.style.display = 'flex';

    const roundInd = document.getElementById('player-round-indicator');
    if (roundInd) roundInd.textContent = `Question ${questionIndex} of ${totalQuestions}`;

    const preview = document.getElementById('player-question-preview');
    if (preview) preview.textContent = question;

    const banner = document.getElementById('player-submitted-banner');
    if (banner) banner.style.display = 'none';

    // Enable 4 buttons with option texts
    options.forEach((optText, idx) => {
      const btn = document.getElementById(`btn-opt-${idx}`);
      const text = document.getElementById(`btn-text-${idx}`);
      if (btn && text) {
        text.textContent = optText;
        btn.disabled = false;
        btn.classList.remove('selected');
      }
    });

    // Linear countdown for player
    let timeLeft = timeLimitSeconds || 15;
    const pTimerBar = document.getElementById('player-timer-bar');
    if (pTimerBar) {
      pTimerBar.style.transition = 'none';
      pTimerBar.style.width = '100%';
      setTimeout(() => {
        pTimerBar.style.transition = `width ${timeLeft}s linear`;
        pTimerBar.style.width = '0%';
      }, 50);
    }
  }
});

// Shared Event: Question Time Up / Answer Revealed
socket.on('question:time_up', ({ correctOption, explanation }) => {
  console.log(`[Game] Time Up! Correct Option: ${correctOption}`);
  if (hostTimerInterval) clearInterval(hostTimerInterval);

  // --- HOST VIEW REVEAL ---
  if (currentRole === 'host') {
    // Highlight correct answer card and dim others
    for (let i = 0; i < 4; i++) {
      const card = document.getElementById(`host-opt-${i}`);
      if (card) {
        if (i === correctOption) {
          card.classList.add('correct-highlight');
        } else {
          card.classList.add('dimmed');
        }
      }
    }

    // Reveal explanation card
    const expCard = document.getElementById('host-explanation-card');
    const expText = document.getElementById('host-explanation-text');
    if (expCard && expText) {
      expText.textContent = explanation || 'Great question!';
      expCard.style.display = 'block';
    }

    SoundFX.correct();
  }

  // --- PLAYER VIEW REVEAL ---
  if (currentRole === 'player') {
    // Disable buttons
    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById(`btn-opt-${i}`);
      if (btn) btn.disabled = true;
    }

    // Show result feedback card
    setTimeout(() => {
      hidePlayerViews();
      const feedbackView = document.getElementById('view-player-feedback');
      if (feedbackView) feedbackView.style.display = 'block';

      const iconEl = document.getElementById('player-feedback-icon');
      const statusEl = document.getElementById('player-feedback-status');
      const ptsEl = document.getElementById('player-feedback-pts');
      const subEl = document.getElementById('player-feedback-sub');
      const totalEl = document.getElementById('player-total-score-display');

      if (lastAnswerFeedback) {
        if (lastAnswerFeedback.isCorrect) {
          feedbackView.className = 'feedback-card correct';
          if (iconEl) iconEl.textContent = '🎉';
          if (statusEl) statusEl.textContent = 'CORRECT!';
          if (ptsEl) ptsEl.textContent = `+${lastAnswerFeedback.pointsAwarded} pts`;
          if (subEl) subEl.textContent = `Speed bonus applied (${(lastAnswerFeedback.timeTakenMs / 1000).toFixed(1)}s response)!`;
          SoundFX.correct();
        } else {
          feedbackView.className = 'feedback-card incorrect';
          if (iconEl) iconEl.textContent = '❌';
          if (statusEl) statusEl.textContent = 'INCORRECT';
          if (ptsEl) ptsEl.textContent = '+0 pts';
          if (subEl) subEl.textContent = 'Better luck on the next question!';
          SoundFX.wrong();
        }
        if (totalEl) totalEl.textContent = `${lastAnswerFeedback.totalScore} pts`;
      } else {
        // Player did not answer in time
        feedbackView.className = 'feedback-card incorrect';
        if (iconEl) iconEl.textContent = '⏱️';
        if (statusEl) statusEl.textContent = "TIME'S UP!";
        if (ptsEl) ptsEl.textContent = '+0 pts';
        if (subEl) subEl.textContent = 'No answer submitted before time expired.';
        if (totalEl) totalEl.textContent = `${currentTotalScore} pts`;
        SoundFX.wrong();
      }
    }, 400);
  }
});

// Shared Event: Live Leaderboard Broadcast
socket.on('leaderboard:update', ({ leaderboard }) => {
  console.log('[Game] Live Leaderboard Update:', leaderboard);

  if (currentRole === 'host') {
    hideHostViews();
    const boardView = document.getElementById('view-host-leaderboard');
    if (boardView) boardView.style.display = 'block';

    const listContainer = document.getElementById('host-leaderboard-list');
    if (listContainer && leaderboard) {
      listContainer.innerHTML = leaderboard.map((player) => {
        const rankClass = player.rank <= 3 ? `rank-${player.rank}` : '';
        const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : `#${player.rank}`;
        const lastPts = player.lastRoundScore > 0 ? `<span class="last-pts-pill">+${player.lastRoundScore}</span>` : '';

        return `
          <div class="leaderboard-row ${rankClass}">
            <div class="rank-badge">${medal}</div>
            <div class="leaderboard-player-info">
              <span class="player-name-text">${player.name}</span>
              ${lastPts}
            </div>
            <div class="player-score-tag">${player.score} pts</div>
          </div>
        `;
      }).join('');
    }
  }

  if (currentRole === 'player' && currentPlayerName) {
    const myRankEntry = leaderboard.find(p => p.name.toLowerCase() === currentPlayerName.toLowerCase());
    if (myRankEntry) {
      currentTotalScore = myRankEntry.score;
      const scoreLive = document.getElementById('player-score-live');
      if (scoreLive) scoreLive.textContent = `${currentTotalScore} pts`;
    }
  }
});

// Shared Event: Final Results & Podium
socket.on('quiz:ended', ({ winner, finalRanks }) => {
  console.log('[Game] Quiz Ended! Winner:', winner);
  launchConfetti(5000);
  SoundFX.fanfare();

  if (currentRole === 'host') {
    hideHostViews();
    const finalView = document.getElementById('view-host-final');
    if (finalView) finalView.style.display = 'block';

    const statusBadge = document.getElementById('host-status-badge');
    if (statusBadge) statusBadge.textContent = 'GAME OVER';

    const winnerNameEl = document.getElementById('host-winner-name');
    const winnerScoreEl = document.getElementById('host-winner-score');
    if (winnerNameEl) winnerNameEl.textContent = winner ? winner.name : 'Everyone';
    if (winnerScoreEl) winnerScoreEl.textContent = winner ? winner.score : 0;

    const ranksContainer = document.getElementById('host-final-ranks-list');
    if (ranksContainer && finalRanks) {
      ranksContainer.innerHTML = finalRanks.map((p) => {
        const rankClass = p.rank <= 3 ? `rank-${p.rank}` : '';
        const medal = p.rank === 1 ? '🥇 Champion' : p.rank === 2 ? '🥈 2nd' : p.rank === 3 ? '🥉 3rd' : `#${p.rank}`;
        return `
          <div class="leaderboard-row ${rankClass}">
            <div class="rank-badge">${medal}</div>
            <div class="leaderboard-player-info">
              <span class="player-name-text">${p.name}</span>
            </div>
            <div class="player-score-tag">${p.score} pts</div>
          </div>
        `;
      }).join('');
    }
  }

  if (currentRole === 'player') {
    hidePlayerViews();
    const playerFinalView = document.getElementById('view-player-final');
    if (playerFinalView) playerFinalView.style.display = 'block';

    const myRankIdx = finalRanks.findIndex(p => p.name.toLowerCase() === currentPlayerName.toLowerCase());
    const myRank = myRankIdx !== -1 ? finalRanks[myRankIdx] : null;

    const titleEl = document.getElementById('player-final-rank-title');
    const subEl = document.getElementById('player-final-rank-sub');
    const scoreEl = document.getElementById('player-final-score-display');
    const iconEl = document.getElementById('player-final-icon');

    if (myRank) {
      if (scoreEl) scoreEl.textContent = myRank.score;
      if (myRank.rank === 1) {
        if (titleEl) titleEl.textContent = '🏆 1st Place - Champion!';
        if (subEl) subEl.textContent = `You dominated the arena with ${myRank.score} points!`;
        if (iconEl) iconEl.textContent = '👑';
      } else if (myRank.rank === 2) {
        if (titleEl) titleEl.textContent = '🥈 2nd Place Podium!';
        if (subEl) subEl.textContent = `Rank #2 out of ${finalRanks.length} players!`;
        if (iconEl) iconEl.textContent = '🥈';
      } else if (myRank.rank === 3) {
        if (titleEl) titleEl.textContent = '🥉 3rd Place Finish!';
        if (subEl) subEl.textContent = `Rank #3 out of ${finalRanks.length} players!`;
        if (iconEl) iconEl.textContent = '🥉';
      } else {
        if (titleEl) titleEl.textContent = 'Great Battle!';
        if (subEl) subEl.textContent = `You finished rank #${myRank.rank} out of ${finalRanks.length} players.`;
        if (iconEl) iconEl.textContent = '🎮';
      }
    }
  }
});

// Host and Player Error / Abort Handlers
socket.on('quiz:error', ({ message }) => {
  alert(`Quiz Notification: ${message}`);
});

socket.on('quiz:aborted', ({ message }) => {
  alert(`Quiz Terminated: ${message}`);
  window.location.href = 'index.html';
});

// ============================================================================
// 🎮 PLAYER SCREEN CONTROLLER & EVENT LISTENERS
// ============================================================================

function initPlayerScreen() {
  currentRole = 'player';
  console.log('[App] Initialized Player Gamepad Controller.');

  // Check URL query parameters for auto-fill (?pin=1234&name=Neo)
  const urlParams = new URLSearchParams(window.location.search);
  const pinParam = urlParams.get('pin');
  const nameParam = urlParams.get('name');

  const pinInput = document.getElementById('player-pin-input');
  const nameInput = document.getElementById('player-name-input');

  if (pinParam && pinInput) pinInput.value = pinParam;
  if (nameParam && nameInput) nameInput.value = nameParam;

  if (pinParam && nameParam) {
    handlePlayerJoin();
  }
}

/**
 * Player submits join form with PIN and Nickname
 */
function handlePlayerJoin(e) {
  if (e) e.preventDefault();
  SoundFX.click();

  const pinInput = document.getElementById('player-pin-input');
  const nameInput = document.getElementById('player-name-input');

  const pin = pinInput ? pinInput.value.trim() : '';
  const playerName = nameInput ? nameInput.value.trim() : '';

  if (pin.length !== 4) {
    alert('Please enter a valid 4-digit PIN.');
    return;
  }

  if (!playerName) {
    alert('Please enter your nickname.');
    return;
  }

  currentPin = pin;
  currentPlayerName = playerName;

  socket.emit('quiz:join', { pin, playerName });
}

// Player Join Confirmation
socket.on('quiz:joined', ({ pin, playerName }) => {
  console.log(`[Player] Successfully joined room ${pin} as "${playerName}"`);
  currentPin = pin;
  currentPlayerName = playerName;

  hidePlayerViews();
  const lobbyView = document.getElementById('view-player-lobby');
  if (lobbyView) lobbyView.style.display = 'block';

  const pinEl = document.getElementById('player-lobby-pin');
  const nameEl = document.getElementById('player-lobby-name');
  const badgeEl = document.getElementById('player-status-badge');

  if (pinEl) pinEl.textContent = pin;
  if (nameEl) nameEl.textContent = playerName;
  if (badgeEl) badgeEl.textContent = 'READY';
});

// Player Join Error
socket.on('quiz:join_error', ({ message }) => {
  alert(`Could not join room: ${message}`);
});

/**
 * Player taps an answer button (Option 0, 1, 2, or 3)
 */
function handlePlayerAnswerSubmit(optionIndex) {
  if (hasAnsweredCurrentQuestion) return;
  if (!currentPin) return;

  SoundFX.click();
  hasAnsweredCurrentQuestion = true;
  const timeTakenMs = questionStartTime ? Math.max(0, Date.now() - questionStartTime) : 1000;

  // Highlight selected button & disable all buttons
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`btn-opt-${i}`);
    if (btn) {
      if (i === optionIndex) {
        btn.classList.add('selected');
      }
      btn.disabled = true;
    }
  }

  // Show submission locked banner
  const banner = document.getElementById('player-submitted-banner');
  if (banner) banner.style.display = 'block';

  // Emit answer:submit to authoritative server
  socket.emit('answer:submit', {
    pin: currentPin,
    selectedOption: optionIndex,
    timeTakenMs
  });
}

// Player Private Answer Feedback from Server
socket.on('answer:feedback', (feedback) => {
  console.log('[Player] Received answer feedback from server:', feedback);
  lastAnswerFeedback = feedback;
  currentTotalScore = feedback.totalScore;

  const scoreLive = document.getElementById('player-score-live');
  if (scoreLive) scoreLive.textContent = `${currentTotalScore} pts`;
});

// ============================================================================
// 🛠️ HELPER FUNCTIONS FOR VIEW TRANSITIONS
// ============================================================================

function hideHostViews() {
  const views = ['view-host-setup', 'view-host-lobby', 'view-host-question', 'view-host-leaderboard', 'view-host-final'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function hidePlayerViews() {
  const views = ['view-player-join', 'view-player-lobby', 'view-player-gamepad', 'view-player-feedback', 'view-player-final'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// Auto-initialize based on active page
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('view-host-setup')) {
    initHostScreen();
  } else if (document.getElementById('view-player-join')) {
    initPlayerScreen();
  }
});
