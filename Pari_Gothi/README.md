# 🧠 Quiz Battle Arena — Real-Time Multiplayer Live Quiz Platform

> **Assignment 14:** Real-Time Multiplayer Live Quiz Battle (Socket.io & Express)  
> **Author:** Pari Gothi  
> **Tech Stack:** Node.js, Express.js, Socket.io, Vanilla HTML5 / CSS3 / JavaScript (No framework)

---
## 🔗  Live Link:
https://pari-gothi-assignment-14-realtime-quiz.onrender.com

---

## 📌 1. Project Overview

**Quiz Battle Arena** is a high-octane, real-time multiplayer trivia and live quiz battle arena (Kahoot / Quizizz style) built on an authoritative Node.js & Socket.io server.

The application features **asymmetric dual interfaces**:
1. **👑 Host / Admin Dashboard (`/host.html`):** Big-screen projector view displaying a 4-digit PIN lobby, live synchronized countdown clock, question presentation, real-time submission counter, correct answer reveals with explanations, live dynamic leaderboards, and grand podium celebration with confetti!
2. **🎮 Player Mobile Gamepad (`/player.html`):** Fast tactile 4-color gamepad (Red Triangle, Blue Diamond, Yellow Circle, Green Square), instant speed feedback, anti-cheat validation, and individual live rankings.

---

## ✨ 2. Key Architecture & Features

- **Authoritative Server Timers:** The server owns the 15-second clock for each question using `setTimeout` / `setInterval`. Client-side timers are purely visual and never trusted for answer cutoff.
- **Strict Anti-Cheat Engine:**
  - Withholds correct answer keys from all `question:start` network payloads.
  - Rejects submissions received after the server clock expires (with a tiny 350ms network jitter tolerance).
  - Prevents duplicate answer submissions for the same question.
- **Speed-Based Scoring Algorithm:** Rewards fast, correct answers with dynamic speed bonuses.
- **Dynamic Leaderboard & Podium:** Live sorting by cumulative score descending with rank changes and podium presentation.
- **Synthesized Web Audio & Canvas Confetti:** Zero external audio/image dependencies — synthesizes crisp tones, beeps, correct chimes, buzzers, and victory fanfare via the Web Audio API.
- **Robust Disconnect Handling:** Gracefully handles player departures from lobby and active game; provides a 20-second reconnection grace period for hosts before terminating.

---

## 🏗️ 3. Directory Layout

```text
Pari_Gothi/
├── public/
│   ├── index.html           # Landing portal: choose Host or Player
│   ├── host.html            # Host dashboard: PIN, lobby roster, live arena, podium
│   ├── player.html          # Mobile-first 4-color gamepad & score feedback
│   ├── app.js               # Shared client Socket.io logic, sound FX, confetti
│   └── style.css            # Dark cyber-glassmorphism responsive design system
├── data/
│   └── questions.json       # Seeded trivia question bank with explanations
├── sockets/
│   ├── gameEngine.js        # Server timers, anti-cheat, scoring, round transitions
│   └── lobbyHandler.js      # Collision-free PIN generation & lobby state
├── server.js                # Express + Socket.io server bootstrap
├── package.json             # NPM dependencies & scripts
├── .env                     # Local environment variables (PORT=5000)
├── .env.example             # Example environment config
├── .gitignore               # Excludes node_modules and .env
└── README.md                # Complete documentation & deployment guide
```

---

## 🧮 4. Server-Side Scoring Formula

Scoring is computed **authoritatively on the server** using the exact formula:

```javascript
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;
  
  const timeRemaining = Math.max(0, totalTimeLimitMs - timeTakenMs);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500); // Up to 500 bonus points
  const baseScore = 500;
  
  return baseScore + speedBonus; // Max 1000 points per question
}
```

- **Incorrect Answer:** `0 points`
- **Correct Answer at t = 0s (Instant):** `500 base + 500 speed = 1000 points`
- **Correct Answer at t = 7.5s (Half time):** `500 base + 250 speed = 750 points`
- **Correct Answer at t = 15s (Last second):** `500 base + 0 speed = 500 points`

---

## 📡 5. Socket.io Event Protocol

### 🎪 Lobby & Room Management
| Event Name | Direction | Payload | Description |
|---|:---:|---|---|
| `quiz:create` | `Host ➔ Server` | `{ hostName, category }` | Initializes a new room & generates 4-digit PIN |
| `quiz:created` | `Server ➔ Host` | `{ pin, roomId }` | Returns assigned PIN and room ID |
| `quiz:join` | `Player ➔ Server` | `{ pin, playerName }` | Player joins room lobby |
| `quiz:joined` | `Server ➔ Player` | `{ pin, playerName, roomState }` | Confirms player join |
| `lobby:update` | `Server ➔ Room` | `{ players: [{ name, score }] }` | Broadcasts lobby roster changes |
| `quiz:start` | `Host ➔ Server` | `{ pin }` | Host triggers the start of the quiz round |

### ⏱️ Question Round & Live Gameplay
| Event Name | Direction | Payload | Description |
|---|:---:|---|---|
| `question:start` | `Server ➔ Room` | `{ questionIndex, totalQuestions, question, options, timeLimitSeconds }` | Broadcasts question. **Omits correct answer** to prevent client inspection. |
| `answer:submit` | `Player ➔ Server` | `{ pin, selectedOption, timeTakenMs }` | Player submits chosen option (0-3). |
| `answer:feedback` | `Server ➔ Player` | `{ success, isCorrect, pointsAwarded, totalScore, timeTakenMs }` | Private instant score feedback to the player. |
| `answer:count_update` | `Server ➔ Room` | `{ answeredCount, totalPlayers }` | Updates live submission count on host dashboard. |
| `question:time_up` | `Server ➔ Room` | `{ correctOption, explanation }` | Server reveals the correct answer and explanation. |
| `leaderboard:update` | `Server ➔ Room` | `{ leaderboard: [{ rank, name, score }] }` | Broadcasts sorted rankings between questions. |
| `quiz:ended` | `Server ➔ Room` | `{ winner: { name, score }, finalRanks: [...] }` | Emitted after last question to show podium. |
| `quiz:aborted` | `Server ➔ Room` | `{ message }` | Sent if host leaves and room is terminated. |

---

## 🛡️ 6. Host & Player Disconnect Handling

1. **Player Disconnection:**
   - In **Lobby State:** Player is immediately removed from the roster and `lobby:update` is broadcast.
   - In **Active Game State:** Player is marked disconnected, preserved on the leaderboard, and remaining active players can continue without blocking round progression.
2. **Host Disconnection:**
   - In **Lobby State:** Room is destroyed immediately and connected players receive a `quiz:aborted` notice.
   - In **Active Game State:** A **20-second grace timer** is initiated. If the host does not reconnect within 20 seconds, the game safely cleans up in-memory state and notifies players.

---

## 🚀 7. Local Installation & Run Guide

### Prerequisites
- Node.js (v16 or higher)
- npm (v8 or higher)

### Steps
```bash
# 1. Navigate to the project directory
cd Pari_Gothi

# 2. Install dependencies
npm install

# 3. Start development server with live reload
npm run dev

# Or start standard production server
npm start
```

The server will be running on **http://localhost:5000**.

---

## 🧪 8. End-to-End Verification Test Flow

1. Open **Tab 1** (Host View): [http://localhost:5000/host.html](http://localhost:5000/host.html)
   - Click **"Launch Room & Generate PIN"** and note the 4-digit PIN (e.g. `4821`).
2. Open **Tab 2** (Player 1): [http://localhost:5000/player.html](http://localhost:5000/player.html)
   - Enter PIN `4821` and Nickname `Player 1` -> Click **"Enter Lobby"**.
3. Open **Tab 3** (Player 2): [http://localhost:5000/player.html](http://localhost:5000/player.html)
   - Enter PIN `4821` and Nickname `Player 2` -> Click **"Enter Lobby"**.
4. On **Tab 1 (Host)**: Verify both players appear in the lobby roster, then click **"Start Game"**.
5. **Question 1:**
   - On Tab 2 (`Player 1`), answer **Option 0 immediately** (~2 seconds).
   - On Tab 3 (`Player 2`), answer **Option 0 after 10 seconds**.
   - Verify `Player 1` receives ~**930+ points** while `Player 2` receives ~**660 points** due to the speed bonus formula.
6. **Question 2:**
   - Let the 15-second timer expire without answering on Tab 3 (`Player 2`).
   - Verify late answers are rejected and `Player 2` receives **0 points** for `TIME'S UP`.
7. **End of Quiz:**
   - After the final question, observe the victory celebration, champion podium, and final rankings.

---

## ☁️ 9. Deployment to Render & GitHub Push Guide

### Step A: Push to GitHub Repo (`itm-assignment-14-quiz-socket`)

```bash
# Initialize git if needed
git init

# Add all project files inside Pari_Gothi
git add .

# Commit changes
git commit -m "feat: complete real-time quiz battle platform with server-authoritative timers"

# Set branch to main
git branch -M main

# Link your GitHub repository (replace with your repo URL)
git remote add origin https://github.com/<your-username>/itm-assignment-14-quiz-socket.git

# Push to GitHub
git push -u origin main
```

### Step B: Deploy to Render

1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** ➔ **Web Service**.
2. Connect your GitHub account and select repository `itm-assignment-14-quiz-socket`.
3. Fill in the service configuration:
   - **Name:** `quiz-battle-arena` (or your preferred name)
   - **Region:** Closest region to you (e.g., Singapore, Frankfurt, Oregon)
   - **Branch:** `main`
   - **Root Directory:** `.` (or `Pari_Gothi` if repository is structured from root)
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Click **Create Web Service**.
5. Once deployment succeeds, Render assigns a live public URL (e.g., `https://quiz-battle-arena.onrender.com`).
6. Test cross-device gameplay by opening the Host URL on a laptop and Player URLs on mobile phones!
