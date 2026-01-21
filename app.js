/********************
 * Farkle PWA (v3)
 * - Above-fold fits screen
 * - Log below fold
 * - Auto-roll after KEEP
 * - Super Scores exact
 ********************/

const LS_KEYS = {
  settings: 'farkle_settings_v3',
  play: 'farkle_play_state_v3',
  log: 'farkle_play_log_v3'
};

const DEFAULT_SETTINGS = {
  minEntry: 500,
  winScore: 10000,
  hotDice: true,
  cpuStyle: 'standard'
};

const AUTO_ROLL_AFTER_KEEP = true;
const AUTO_ROLL_DELAY_MS = 220;

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function clampInt(n, fallback) {
  const x = parseInt(String(n ?? ''), 10);
  return Number.isFinite(x) ? x : fallback;
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1300);
}
function nowTime() {
  return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

let settings = loadJSON(LS_KEYS.settings, DEFAULT_SETTINGS);

/********************
 * CPU threshold
 ********************/
function cpuThreshold(style) {
  if (style === 'conservative') return 650;
  if (style === 'aggressive') return 1200;
  return 900;
}

/********************
 * Dice / scoring
 ********************/
function rollN(n) {
  const arr = [];
  for (let i=0;i<n;i++) arr.push(1 + Math.floor(Math.random()*6));
  return arr;
}
function countDice(values) {
  const c = [0,0,0,0,0,0,0];
  for (const v of values) if (v>=1 && v<=6) c[v]++;
  return c;
}
function totalCount(counts) {
  return counts.slice(1).reduce((a,b)=>a+b,0);
}

// Exact scoring per your “Super Scores” table
function scoreExact(countsIn) {
  const memo = new Map();
  const keyOf = (c) => c.slice(1).join('');

  function rec(counts) {
    const key = keyOf(counts);
    if (memo.has(key)) return memo.get(key);

    const dice = totalCount(counts);
    if (dice === 0) return 0;

    let best = -Infinity;

    // Special 6-dice combos
    if (dice === 6) {
      const isStraight = [1,2,3,4,5,6].every(f => counts[f] === 1);
      if (isStraight) best = Math.max(best, 1500);

      const pairs = [1,2,3,4,5,6].filter(f => counts[f] === 2).length;
      if (pairs === 3) best = Math.max(best, 1500);

      const triples = [1,2,3,4,5,6].filter(f => counts[f] === 3).length;
      if (triples === 2) best = Math.max(best, 2500);

      const has4 = [1,2,3,4,5,6].some(f => counts[f] === 4);
      const has2 = [1,2,3,4,5,6].some(f => counts[f] === 2);
      if (has4 && has2) best = Math.max(best, 1500);
    }

    // 6/5/4 of a kind (flat per screenshot)
    for (let f=1; f<=6; f++) {
      if (counts[f] >= 6) {
        const c2 = counts.slice(); c2[f] -= 6;
        best = Math.max(best, 3000 + rec(c2));
      }
      if (counts[f] >= 5) {
        const c2 = counts.slice(); c2[f] -= 5;
        best = Math.max(best, 2000 + rec(c2));
      }
      if (counts[f] >= 4) {
        const c2 = counts.slice(); c2[f] -= 4;
        best = Math.max(best, 1000 + rec(c2));
      }
    }

    // 3 of a kind (1=1000, others=face*100)
    for (let f=1; f<=6; f++) {
      if (counts[f] >= 3) {
        const base = (f === 1) ? 1000 : f * 100;
        const c2 = counts.slice(); c2[f] -= 3;
        best = Math.max(best, base + rec(c2));
      }
    }

    // single 1/5
    if (counts[1] >= 1) {
      const c2 = counts.slice(); c2[1] -= 1;
      best = Math.max(best, 100 + rec(c2));
    }
    if (counts[5] >= 1) {
      const c2 = counts.slice(); c2[5] -= 1;
      best = Math.max(best, 50 + rec(c2));
    }

    if (best === -Infinity) best = -1;
    memo.set(key, best);
    return best;
  }

  const res = rec(countsIn.slice());
  return res < 0 ? 0 : res;
}

function bestScoreForRoll(values) {
  return scoreExact(countDice(values));
}
function scoreSelection(values) {
  if (!values.length) return 0;
  return scoreExact(countDice(values));
}

/********************
 * State
 ********************/
function newState() {
  return {
    currentPlayer: 'you',
    you: { score: 0, onBoard: false },
    cpu: { score: 0, onBoard: false },

    turnPoints: 0,
    diceLeft: 6,

    tray: [],   // [{id,value,selected}]
    kept: [],   // for pyramid display (current cycle)
    awaitingDone: false,
    gameOver: false
  };
}

let state = loadJSON(LS_KEYS.play, newState());
let log = loadJSON(LS_KEYS.log, []);

/********************
 * Log
 ********************/
function logLine(text, who='') {
  log.unshift({ t: Date.now(), who, text });
  log = log.slice(0, 90);
  saveJSON(LS_KEYS.log, log);
  renderLog();
}

/********************
 * UI refs
 ********************/
const elYouScore = document.getElementById('youScore');
const elCpuScore = document.getElementById('cpuScore');
const elYouBoard = document.getElementById('youBoardStatus');
const elCpuBoard = document.getElementById('cpuBoardStatus');
const elTurnPoints = document.getElementById('turnPoints');
const elSelectedPoints = document.getElementById('selectedPoints');
const elDiceLeft = document.getElementById('diceLeft');
const elTurnBadge = document.getElementById('turnBadge');

const elTray = document.getElementById('traySlots');
const elPyr = document.getElementById('keptPyramid');
const elLog = document.getElementById('turnLog');

const btnRoll = document.getElementById('btnRoll');
const btnKeep = document.getElementById('btnKeep');
const btnBank = document.getElementById('btnBank');
const btnDone = document.getElementById('btnDone');

const btnClearLog = document.getElementById('btnClearLog');
const btnOpenSettings = document.getElementById('btnOpenSettings');
const settingsSheet = document.getElementById('settingsSheet');
const btnCloseSettings = document.getElementById('btnCloseSettings');

const setMinEntry = document.getElementById('setMinEntry');
const setWinScore = document.getElementById('setWinScore');
const setHotDice = document.getElementById('setHotDice');
const setCpuStyle = document.getElementById('setCpuStyle');
const btnResetEverything = document.getElementById('btnResetEverything');

function render() {
  document.getElementById('goalText').textContent = `${settings.winScore} POINTS`;

  elYouScore.textContent = state.you.score;
  elCpuScore.textContent = state.cpu.score;

  elYouBoard.textContent = state.you.onBoard ? 'On board' : `Need ${settings.minEntry} to board`;
  elCpuBoard.textContent = state.cpu.onBoard ? 'On board' : `Need ${settings.minEntry} to board`;

  elTurnPoints.textContent = state.turnPoints;
  elDiceLeft.textContent = String(state.diceLeft);

  const selVals = state.tray.filter(d => d.selected).map(d => d.value);
  const selScore = scoreSelection(selVals);
  elSelectedPoints.textContent = String(selScore);

  elTurnBadge.textContent = state.gameOver
    ? 'Game over'
    : (state.currentPlayer === 'you'
        ? (state.awaitingDone ? 'Tap DONE' : 'Your turn')
        : 'CPU turn');

  // Tray: always 6 slots
  elTray.innerHTML = '';
  for (let i=0;i<6;i++) {
    const d = state.tray[i];
    const div = document.createElement('div');
    div.className = 'die ' + (d ? (d.selected ? 'selected' : '') : 'empty');
    div.textContent = d ? String(d.value) : '·';

    if (d && state.currentPlayer === 'you' && !state.awaitingDone && !state.gameOver) {
      div.addEventListener('click', () => {
        d.selected = !d.selected;
        saveJSON(LS_KEYS.play, state);
        render();
      });
    }
    elTray.appendChild(div);
  }

  // Pyramid slots (1+2+3+4+5) centered in 6 columns
  elPyr.innerHTML = '';
  const ROWS = [1,2,3,4,5];
  let idx = 0;
  for (let r=0;r<ROWS.length;r++) {
    const len = ROWS[r];
    const start = Math.floor((6 - len) / 2);
    const end = start + len;
    for (let c=0;c<6;c++) {
      const slot = document.createElement('div');

      if (c < start || c >= end) {
        slot.className = 'pSlot';
        slot.style.visibility = 'hidden';
        elPyr.appendChild(slot);
        continue;
      }

      const val = state.kept[idx++];
      slot.className = 'pSlot ' + (val ? 'filled' : '');
      if (val) slot.textContent = String(val);
      elPyr.appendChild(slot);
    }
  }

  // Buttons
  const yourTurn = state.currentPlayer === 'you' && !state.gameOver;
  const hasTray = state.tray.length > 0;

  btnRoll.disabled = !(yourTurn && !state.awaitingDone && !hasTray);
  btnKeep.disabled = !(yourTurn && !state.awaitingDone && hasTray && selScore > 0);
  btnBank.disabled = !(yourTurn && !state.awaitingDone && state.turnPoints > 0);
  btnDone.disabled = !(state.awaitingDone && !state.gameOver);
}

function renderLog() {
  elLog.innerHTML = '';
  if (!log.length) {
    const empty = document.createElement('div');
    empty.className = 'line';
    empty.textContent = 'No log yet.';
    elLog.appendChild(empty);
    return;
  }
  for (const item of log) {
    const line = document.createElement('div');
    line.className = `line ${item.who || ''}`;
    line.textContent = `${nowTime()} — ${item.text}`;
    elLog.appendChild(line);
  }
}

/********************
 * Actions
 ********************/
function resetTurnToFresh() {
  state.turnPoints = 0;
  state.diceLeft = 6;
  state.tray = [];
  state.kept = [];
}

function doFarkle(whoLabel='You') {
  resetTurnToFresh();
  state.awaitingDone = true;
  logLine(`${whoLabel} FARKLE — lost turn points`, 'warn');
  toast('Farkle!');
  saveJSON(LS_KEYS.play, state);
  render();
}

function doRoll() {
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;
  if (state.tray.length) return;

  const values = rollN(state.diceLeft);
  state.tray = values.map(v => ({ id: uid(), value: v, selected: false }));

  logLine(`You rolled: ${values.join(', ')}`, 'you');

  if (bestScoreForRoll(values) === 0) {
    saveJSON(LS_KEYS.play, state);
    render();
    doFarkle('You');
    return;
  }

  saveJSON(LS_KEYS.play, state);
  render();
}

function scheduleAutoRollIfNeeded() {
  if (!AUTO_ROLL_AFTER_KEEP) return;
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;
  if (state.tray.length) return; // only if tray is empty
  if (state.diceLeft <= 0) return;

  setTimeout(() => {
    // re-check in case state changed
    if (state.gameOver) return;
    if (state.currentPlayer !== 'you') return;
    if (state.awaitingDone) return;
    if (state.tray.length) return;
    // auto roll
    doRoll();
  }, AUTO_ROLL_DELAY_MS);
}

function doKeep() {
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;
  if (!state.tray.length) return;

  const sel = state.tray.filter(d => d.selected).map(d => d.value);
  const score = scoreSelection(sel);
  if (score <= 0) { toast('Invalid selection'); return; }

  // Move selected
  const keptDice = [];
  const remaining = [];
  for (const d of state.tray) {
    if (d.selected) keptDice.push(d.value);
    else remaining.push(d);
  }

  state.turnPoints += score;
  state.kept.push(...keptDice);
  state.diceLeft = remaining.length;
  state.tray = []; // tray clears (matches reference flow)

  logLine(`You kept ${keptDice.join(', ')} (+${score}), turn=${state.turnPoints}`, 'you');

  // Hot dice
  if (state.diceLeft === 0) {
    if (settings.hotDice) {
      state.diceLeft = 6;
      state.kept = []; // reset pyramid for the next “cycle”
      logLine(`You hot dice!`, 'you');
      toast('Hot dice!');
    } else {
      state.awaitingDone = true;
      logLine(`No dice left — turn ends`, 'you');
    }
  }

  saveJSON(LS_KEYS.play, state);
  render();

  // AUTO-ROLL NEXT
  scheduleAutoRollIfNeeded();
}

function doBank() {
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;
  if (state.turnPoints <= 0) return;

  const tp = state.turnPoints;
  const p = state.you;

  if (!p.onBoard) {
    if (tp >= settings.minEntry) {
      p.onBoard = true;
      p.score += tp;
      logLine(`You banked ${tp} (on board)`, 'you');
    } else {
      logLine(`Bank failed (<${settings.minEntry}) — scored 0`, 'warn');
    }
  } else {
    p.score += tp;
    logLine(`You banked ${tp}`, 'you');
  }

  resetTurnToFresh();
  state.awaitingDone = true;

  if (p.score >= settings.winScore) {
    state.gameOver = true;
    logLine(`🏁 You win! (${p.score})`, 'you');
    toast('You win!');
  }

  saveJSON(LS_KEYS.play, state);
  render();
}

function doDone() {
  if (!state.awaitingDone) return;

  state.awaitingDone = false;

  if (state.gameOver) {
    saveJSON(LS_KEYS.play, state);
    render();
    return;
  }

  // CPU turn
  state.currentPlayer = 'cpu';
  resetTurnToFresh();
  saveJSON(LS_KEYS.play, state);
  render();

  cpuTurn().catch(()=>{});
}

async function cpuTurn() {
  if (state.gameOver) return;

  const pause = (ms) => new Promise(res => setTimeout(res, ms));
  const threshold = cpuThreshold(settings.cpuStyle);

  logLine('CPU turn start', 'cpu');
  await pause(250);

  let tp = 0;
  let diceLeft = 6;

  for (let rollCount=1; rollCount<=8; rollCount++) {
    const values = rollN(diceLeft);
    logLine(`CPU rolled: ${values.join(', ')}`, 'cpu');
    await pause(220);

    if (bestScoreForRoll(values) === 0) {
      tp = 0;
      logLine('CPU FARKLE — scored 0', 'warn');
      break;
    }

    const keep = cpuChooseBestKeep(values);
    const s = scoreSelection(keep);

    tp += s;
    diceLeft = values.length - keep.length;

    logLine(`CPU kept ${keep.join(', ')} (+${s}), turn=${tp}`, 'cpu');
    await pause(220);

    if (diceLeft === 0 && settings.hotDice) {
      diceLeft = 6;
      logLine('CPU hot dice!', 'cpu');
      await pause(200);
    } else if (diceLeft === 0) {
      break;
    }

    const cpu = state.cpu;
    const canBankToBoard = (!cpu.onBoard && tp >= settings.minEntry);
    const canBank = cpu.onBoard || canBankToBoard;

    const wantsBank = canBank && (tp >= threshold || rollCount >= 4);
    if (wantsBank) {
      if (!cpu.onBoard) cpu.onBoard = true;
      cpu.score += tp;
      logLine(`CPU banked ${tp}`, 'cpu');
      break;
    }
  }

  // back to you
  state.currentPlayer = 'you';
  resetTurnToFresh();
  state.awaitingDone = false;

  if (state.cpu.score >= settings.winScore) {
    state.gameOver = true;
    logLine(`🏁 CPU wins! (${state.cpu.score})`, 'cpu');
    toast('CPU wins');
  } else {
    toast('Your turn');
  }

  saveJSON(LS_KEYS.play, state);
  render();
}

function cpuChooseBestKeep(values) {
  // brute-force all subsets (6 max): pick max score; tie-breaker keep more dice
  const n = values.length;
  let bestScore = 0;
  let bestKeep = [];

  for (let mask=1; mask<(1<<n); mask++) {
    const subset = [];
    for (let i=0;i<n;i++) if (mask & (1<<i)) subset.push(values[i]);
    const s = scoreSelection(subset);
    if (s > 0) {
      if (s > bestScore) { bestScore = s; bestKeep = subset; }
      else if (s === bestScore && subset.length > bestKeep.length) { bestKeep = subset; }
    }
  }

  if (bestScore === 0) {
    if (values.includes(1)) return [1];
    if (values.includes(5)) return [5];
  }
  return bestKeep;
}

/********************
 * Settings
 ********************/
function openSettings() {
  setMinEntry.value = String(settings.minEntry);
  setWinScore.value = String(settings.winScore);
  setHotDice.checked = !!settings.hotDice;
  setCpuStyle.value = settings.cpuStyle;
  settingsSheet.classList.remove('hidden');
}
function closeSettings() {
  settingsSheet.classList.add('hidden');
}
function saveSettingsFromUI() {
  settings.minEntry = clampInt(setMinEntry.value, DEFAULT_SETTINGS.minEntry);
  settings.winScore = clampInt(setWinScore.value, DEFAULT_SETTINGS.winScore);
  settings.hotDice = !!setHotDice.checked;
  settings.cpuStyle = setCpuStyle.value || 'standard';
  saveJSON(LS_KEYS.settings, settings);
}

function resetEverything() {
  localStorage.clear();
  settings = { ...DEFAULT_SETTINGS };
  state = newState();
  log = [];
  saveJSON(LS_KEYS.settings, settings);
  saveJSON(LS_KEYS.play, state);
  saveJSON(LS_KEYS.log, log);
  toast('Reset complete');
  closeSettings();
  renderLog();
  render();
}

/********************
 * Events
 ********************/
btnRoll.addEventListener('click', doRoll);
btnKeep.addEventListener('click', doKeep);
btnBank.addEventListener('click', doBank);
btnDone.addEventListener('click', doDone);

btnClearLog.addEventListener('click', () => {
  log = [];
  saveJSON(LS_KEYS.log, log);
  renderLog();
  toast('Log cleared');
});

btnOpenSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);

[setMinEntry,setWinScore,setCpuStyle].forEach(el => el.addEventListener('change', () => {
  saveSettingsFromUI(); toast('Saved'); render();
}));
setHotDice.addEventListener('change', () => { saveSettingsFromUI(); toast('Saved'); });

btnResetEverything.addEventListener('click', resetEverything);

/********************
 * Service worker
 ********************/
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/********************
 * Init
 ********************/
function init() {
  if (!state || typeof state !== 'object') state = newState();
  if (!state.you) state = newState();
  if (!Array.isArray(state.tray)) state.tray = [];
  if (!Array.isArray(state.kept)) state.kept = [];
  if (!Number.isFinite(state.diceLeft)) state.diceLeft = 6;

  saveJSON(LS_KEYS.settings, settings);
  saveJSON(LS_KEYS.play, state);

  renderLog();
  render();
}
init();
