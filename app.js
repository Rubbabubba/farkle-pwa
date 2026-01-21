/********************
 * Farkle PWA (v2)
 * Screenshot-style UI + Super Scores
 * - Min entry: 500
 * - Win: 10,000
 * - Hot dice: toggle
 * - CPU: conservative/standard/aggressive
 ********************/

const LS_KEYS = {
  settings: 'farkle_settings_v2',
  play: 'farkle_play_state_v2',
  undo: 'farkle_play_undo_v2',
  log: 'farkle_play_log_v2'
};

const DEFAULT_SETTINGS = {
  minEntry: 500,
  winScore: 10000,
  hotDice: true,
  cpuStyle: 'standard' // conservative | standard | aggressive
};

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
  toast._t = setTimeout(() => el.classList.remove('show'), 1400);
}
function nowTime() {
  return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

let settings = loadJSON(LS_KEYS.settings, DEFAULT_SETTINGS);

/********************
 * CPU threshold (bank at >= threshold, if allowed)
 ********************/
function cpuThreshold(style) {
  if (style === 'conservative') return 650;
  if (style === 'aggressive') return 1200;
  return 900; // standard
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
  const c = [0,0,0,0,0,0,0]; // 1..6
  for (const v of values) if (v>=1 && v<=6) c[v]++;
  return c;
}
function totalCount(counts) {
  return counts.slice(1).reduce((a,b)=>a+b,0);
}

/**
 * Super Scores (exactly like your screenshot)
 * - 4 kind = 1000
 * - 5 kind = 2000
 * - 6 kind = 3000
 * - straight 1–6 = 1500
 * - 3 pairs = 1500
 * - 4 kind + 1 pair = 1500
 * - 2 triples = 2500
 * Standard:
 * - single 1 = 100
 * - single 5 = 50
 * - 3-kind: 1s = 1000, others = face*100
 */
function scoreExact(countsIn) {
  const memo = new Map();

  const keyOf = (c) => c.slice(1).join('');

  function rec(counts) {
    const key = keyOf(counts);
    if (memo.has(key)) return memo.get(key);

    const dice = totalCount(counts);
    if (dice === 0) return 0;

    let best = -Infinity;

    // Special 6-dice combos (only if exactly 6 dice in this subproblem)
    if (dice === 6) {
      // Straight
      const isStraight = [1,2,3,4,5,6].every(f => counts[f] === 1);
      if (isStraight) best = Math.max(best, 1500);

      // Three pairs
      const pairs = [1,2,3,4,5,6].filter(f => counts[f] === 2).length;
      if (pairs === 3) best = Math.max(best, 1500);

      // Two triples
      const triples = [1,2,3,4,5,6].filter(f => counts[f] === 3).length;
      if (triples === 2) best = Math.max(best, 2500);

      // 4 of a kind + 1 pair
      const has4 = [1,2,3,4,5,6].some(f => counts[f] === 4);
      const has2 = [1,2,3,4,5,6].some(f => counts[f] === 2);
      if (has4 && has2) best = Math.max(best, 1500);
    }

    // Try taking a scoring set, recurse on remainder.

    // 6/5/4 of a kind
    for (let f=1; f<=6; f++) {
      if (counts[f] >= 6) {
        const c2 = counts.slice();
        c2[f] -= 6;
        best = Math.max(best, 3000 + rec(c2));
      }
      if (counts[f] >= 5) {
        const c2 = counts.slice();
        c2[f] -= 5;
        best = Math.max(best, 2000 + rec(c2));
      }
      if (counts[f] >= 4) {
        const c2 = counts.slice();
        c2[f] -= 4;
        best = Math.max(best, 1000 + rec(c2));
      }
    }

    // 3 of a kind
    for (let f=1; f<=6; f++) {
      if (counts[f] >= 3) {
        const base = (f === 1) ? 1000 : f * 100;
        const c2 = counts.slice();
        c2[f] -= 3;
        best = Math.max(best, base + rec(c2));
      }
    }

    // single 1 / 5
    if (counts[1] >= 1) {
      const c2 = counts.slice();
      c2[1] -= 1;
      best = Math.max(best, 100 + rec(c2));
    }
    if (counts[5] >= 1) {
      const c2 = counts.slice();
      c2[5] -= 1;
      best = Math.max(best, 50 + rec(c2));
    }

    // If we cannot consume all dice with scoring sets, mark invalid
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
 * Play state
 ********************/
function newPlayState() {
  return {
    currentPlayer: 'you', // 'you'|'cpu'
    you: { score: 0, onBoard: false },
    cpu: { score: 0, onBoard: false },
    turnPoints: 0,

    // current roll / tray
    tray: [], // [{id,value,selected}]
    kept: [], // kept dice values in-order (for pyramid)
    diceLeft: 6,

    awaitingDone: false,
    gameOver: false
  };
}

let state = loadJSON(LS_KEYS.play, newPlayState());
let undo = loadJSON(LS_KEYS.undo, null);
let log = loadJSON(LS_KEYS.log, []);

function pushUndo() {
  undo = JSON.parse(JSON.stringify(state));
  saveJSON(LS_KEYS.undo, undo);
}
function logLine(text, who='') {
  log.unshift({ t: Date.now(), who, text });
  log = log.slice(0, 70);
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

const btnResetAll = document.getElementById('btnResetAll');
const btnClearLog = document.getElementById('btnClearLog');

const settingsSheet = document.getElementById('settingsSheet');
const btnCloseSettings = document.getElementById('btnCloseSettings');

const setMinEntry = document.getElementById('setMinEntry');
const setWinScore = document.getElementById('setWinScore');
const setHotDice = document.getElementById('setHotDice');
const setCpuStyle = document.getElementById('setCpuStyle');
const btnResetEverything = document.getElementById('btnResetEverything');

document.getElementById('goalText').textContent = `${settings.minEntry} TO BOARD`;

/********************
 * Rendering helpers
 ********************/
function render() {
  elYouScore.textContent = state.you.score;
  elCpuScore.textContent = state.cpu.score;

  elYouBoard.textContent = state.you.onBoard ? 'On board' : `Need ${settings.minEntry} to board`;
  elCpuBoard.textContent = state.cpu.onBoard ? 'On board' : `Need ${settings.minEntry} to board`;

  elTurnPoints.textContent = state.turnPoints;

  const selVals = state.tray.filter(d => d.selected).map(d => d.value);
  elSelectedPoints.textContent = String(scoreSelection(selVals));

  elDiceLeft.textContent = String(state.diceLeft);

  const isYourTurn = state.currentPlayer === 'you' && !state.gameOver;
  const badgeText = state.gameOver
    ? 'Game over'
    : (state.currentPlayer === 'you' ? (state.awaitingDone ? 'Tap DONE' : 'Your turn') : 'CPU turn');
  elTurnBadge.textContent = badgeText;

  // Tray slots (always show 6 slots)
  elTray.innerHTML = '';
  const trayToShow = state.tray.slice(0, 6);
  for (let i=0;i<6;i++) {
    const d = trayToShow[i];
    const div = document.createElement('div');
    div.className = 'die ' + (d ? (d.selected ? 'selected' : '') : 'empty');
    div.textContent = d ? String(d.value) : '·';

    if (d && isYourTurn && !state.awaitingDone) {
      div.addEventListener('click', () => {
        d.selected = !d.selected;
        saveJSON(LS_KEYS.play, state);
        render();
      });
    }
    elTray.appendChild(div);
  }

  // Kept pyramid: fixed “triangular” slot layout 1+2+3+4+5 = 15 slots (like screenshot vibe)
  // We fill left-to-right, top-to-bottom
  const SLOT_COUNTS = [1,2,3,4,5];
  const totalSlots = SLOT_COUNTS.reduce((a,b)=>a+b,0);
  elPyr.innerHTML = '';

  const keptVals = state.kept.slice(0, totalSlots);

  let idx = 0;
  for (let r=0; r<SLOT_COUNTS.length; r++) {
    for (let c=0; c<6; c++) {
      // create a “row with left padding” by skipping some leading columns
      // row lengths: 1,2,3,4,5 centered roughly in 6-column grid
      const len = SLOT_COUNTS[r];
      const start = Math.floor((6 - len) / 2);
      const end = start + len;
      if (c < start || c >= end) {
        const spacer = document.createElement('div');
        spacer.style.visibility = 'hidden';
        spacer.className = 'pSlot';
        elPyr.appendChild(spacer);
        continue;
      }

      const slot = document.createElement('div');
      const val = keptVals[idx++];
      slot.className = 'pSlot ' + (val ? 'filled' : '');
      slot.textContent = val ? String(val) : '';
      elPyr.appendChild(slot);
    }
  }

  // Buttons
  const hasTray = state.tray.length > 0;
  const canRoll = isYourTurn && !state.awaitingDone && !hasTray;
  const canDone = state.awaitingDone && !state.gameOver;

  const selScore = scoreSelection(selVals);
  const canKeep = isYourTurn && !state.awaitingDone && hasTray && selScore > 0;
  const canBank = isYourTurn && !state.awaitingDone && state.turnPoints > 0;

  btnRoll.disabled = !canRoll;
  btnKeep.disabled = !canKeep;
  btnBank.disabled = !canBank;
  btnDone.disabled = !canDone;

  // Goal pill in center: show win target (like top “points”)
  const goal = document.getElementById('goalText');
  goal.textContent = `${settings.winScore} POINTS`;
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
 * Game actions
 ********************/
function farkle() {
  state.turnPoints = 0;
  state.tray = [];
  state.kept = [];
  state.diceLeft = 6;
  state.awaitingDone = true;
  logLine('FARKLE — lost turn points', 'warn');
  toast('Farkle!');
}

function doRoll() {
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;

  pushUndo();

  const values = rollN(state.diceLeft);
  state.tray = values.map(v => ({ id: uid(), value: v, selected: false }));

  logLine(`You rolled: ${values.join(', ')}`, 'you');

  // Farkle check
  if (bestScoreForRoll(values) === 0) {
    saveJSON(LS_KEYS.play, state);
    render();
    farkle();
    saveJSON(LS_KEYS.play, state);
    render();
    return;
  }

  saveJSON(LS_KEYS.play, state);
  render();
}

function doKeep() {
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;

  const sel = state.tray.filter(d => d.selected).map(d => d.value);
  const score = scoreSelection(sel);
  if (score <= 0) {
    toast('Invalid selection');
    return;
  }

  pushUndo();

  // Move selected to kept
  const keptDice = [];
  const remainingDice = [];
  for (const d of state.tray) {
    if (d.selected) keptDice.push(d.value);
    else remainingDice.push(d);
  }

  state.turnPoints += score;
  state.kept.push(...keptDice);

  // Update dice left
  state.diceLeft = remainingDice.length;

  // Clear tray (next action is roll again) unless hot dice triggers
  state.tray = [];

  // Hot dice: if all dice were used (diceLeft === 0), reset to 6 and continue
  if (state.diceLeft === 0) {
    if (settings.hotDice) {
      state.diceLeft = 6;
      state.kept = []; // visually reset kept pyramid for the next “cycle” (like many apps)
      logLine(`Hot dice! (+${score}) Roll all 6 again`, 'you');
      toast('Hot dice!');
    } else {
      state.awaitingDone = true;
      logLine(`No dice left — turn ends`, 'you');
    }
  } else {
    logLine(`Kept ${sel.join(', ')} (+${score})`, 'you');
  }

  saveJSON(LS_KEYS.play, state);
  render();
}

function doBank() {
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;
  if (state.turnPoints <= 0) return;

  pushUndo();

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

  // Reset turn
  state.turnPoints = 0;
  state.tray = [];
  state.kept = [];
  state.diceLeft = 6;
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

  pushUndo();

  state.awaitingDone = false;

  if (state.gameOver) {
    saveJSON(LS_KEYS.play, state);
    render();
    return;
  }

  // switch to CPU
  state.currentPlayer = 'cpu';
  state.tray = [];
  state.kept = [];
  state.diceLeft = 6;

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

  for (let rollCount=1; rollCount<=6; rollCount++) {
    const values = rollN(diceLeft);
    logLine(`CPU rolled: ${values.join(', ')}`, 'cpu');
    await pause(220);

    if (bestScoreForRoll(values) === 0) {
      tp = 0;
      logLine('CPU FARKLE — scored 0', 'warn');
      break;
    }

    // CPU keep: greedy—take the best exact scoring subset by trying all subsets (6 dice only)
    const keep = cpuChooseBestKeep(values);
    const s = scoreSelection(keep);

    tp += s;
    diceLeft = values.length - keep.length;

    logLine(`CPU kept ${keep.join(', ')} (+${s}), turn=${tp}`, 'cpu');
    await pause(220);

    // hot dice
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

  // switch back to you
  state.turnPoints = 0;
  state.currentPlayer = 'you';
  state.tray = [];
  state.kept = [];
  state.diceLeft = 6;
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
  // Try all subsets (except empty). Keep the subset with max score.
  // Tie-breaker: keep more dice (reduces risk), then higher score.
  const n = values.length;
  let best = { score: 0, keep: [] };

  for (let mask=1; mask<(1<<n); mask++) {
    const subset = [];
    for (let i=0;i<n;i++) if (mask & (1<<i)) subset.push(values[i]);
    const s = scoreSelection(subset);
    if (s > 0) {
      if (s > best.score) best = { score: s, keep: subset };
      else if (s === best.score && subset.length > best.keep.length) best = { score: s, keep: subset };
    }
  }

  // If none found (shouldn't happen if roll has a best score), fallback
  if (best.score === 0) {
    if (values.includes(1)) return [1];
    if (values.includes(5)) return [5];
  }
  return best.keep;
}

/********************
 * Settings sheet
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

/********************
 * Reset
 ********************/
function resetEverything() {
  localStorage.clear();
  settings = { ...DEFAULT_SETTINGS };
  state = newPlayState();
  undo = null;
  log = [];
  saveJSON(LS_KEYS.settings, settings);
  saveJSON(LS_KEYS.play, state);
  saveJSON(LS_KEYS.undo, undo);
  saveJSON(LS_KEYS.log, log);
  toast('Reset complete');
  closeSettings();
  renderLog();
  render();
}

/********************
 * Wire events
 ********************/
btnRoll.addEventListener('click', doRoll);
btnKeep.addEventListener('click', doKeep);
btnBank.addEventListener('click', doBank);
btnDone.addEventListener('click', doDone);

btnResetAll.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);

btnClearLog.addEventListener('click', () => {
  log = [];
  saveJSON(LS_KEYS.log, log);
  renderLog();
  toast('Log cleared');
});

setMinEntry.addEventListener('change', () => { saveSettingsFromUI(); toast('Saved'); render(); });
setWinScore.addEventListener('change', () => { saveSettingsFromUI(); toast('Saved'); render(); });
setHotDice.addEventListener('change', () => { saveSettingsFromUI(); toast('Saved'); render(); });
setCpuStyle.addEventListener('change', () => { saveSettingsFromUI(); toast('Saved'); render(); });

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
 * Init / normalize
 ********************/
function init() {
  // Normalize loaded state (guard if older state exists)
  if (!state || typeof state !== 'object') state = newPlayState();
  if (!state.you) state = newPlayState();
  if (!Array.isArray(state.tray)) state.tray = [];
  if (!Array.isArray(state.kept)) state.kept = [];
  if (!Number.isFinite(state.diceLeft)) state.diceLeft = 6;

  saveJSON(LS_KEYS.settings, settings);
  saveJSON(LS_KEYS.play, state);

  renderLog();
  render();
}
init();
