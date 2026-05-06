/********************
 * Farkle PWA (v4)
 * - 3 action buttons row styled like Roll
 * - Auto-roll after KEEP
 * - Above-fold fits screen, log below fold
 ********************/

const LS_KEYS = {
  settings: 'farkle_settings_v4',
  play: 'farkle_play_state_v4',
  log: 'farkle_play_log_v4'
};

const AUTO_ROLL_AFTER_KEEP = true;
const AUTO_ROLL_DELAY_MS = 220;

const {
  DEFAULT_SETTINGS,
  bestScoreForRoll,
  cpuChooseBestKeep,
  cpuThreshold,
  newState,
  rollDice,
  scoreSelection
} = window.FarkleEngine;

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
let state = loadJSON(LS_KEYS.play, newState());
let log = loadJSON(LS_KEYS.log, []);

function logLine(text, who='') {
  log.unshift({ t: Date.now(), who, text });
  log = log.slice(0, 90);
  saveJSON(LS_KEYS.log, log);
  renderLog();
}

/* UI refs */
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

  // Pyramid slots
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

  // Buttons enabled/disabled
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

function applyTransition(result) {
  for (const event of result.events) {
    if (event.type === 'log') logLine(event.text, event.who);
    if (event.type === 'toast') toast(event.text);
  }

  state = result.state;
  saveJSON(LS_KEYS.play, state);
  render();
  
  return result;
}

function doRoll() {
  const values = rollDice(state.diceLeft);
  const dice = values.map(v => ({ id: uid(), value: v, selected: false }));
  applyTransition(transitionGame(state, { type: ACTIONS.ROLL, dice }, settings));
}

function scheduleAutoRollIfNeeded() {
  if (!AUTO_ROLL_AFTER_KEEP) return;
  if (state.gameOver) return;
  if (state.currentPlayer !== 'you') return;
  if (state.awaitingDone) return;
  if (state.tray.length) return;
  if (state.diceLeft <= 0) return;

  setTimeout(() => {
    if (state.gameOver) return;
    if (state.currentPlayer !== 'you') return;
    if (state.awaitingDone) return;
    if (state.tray.length) return;
    doRoll();
  }, AUTO_ROLL_DELAY_MS);
}

function doKeep() {
  const result = applyTransition(transitionGame(state, { type: ACTIONS.KEEP }, settings));
  if (result.ok) scheduleAutoRollIfNeeded();
  }

function doBank() {
  applyTransition(transitionGame(state, { type: ACTIONS.BANK }, settings));
}

function doDone() {
  const result = applyTransition(transitionGame(state, { type: ACTIONS.DONE }, settings));
  if (result.events.some(event => event.type === 'cpuTurnRequested')) {
    cpuTurn().catch(()=>{});
  }
}

async function cpuTurn() {
  if (state.gameOver) return;

  const pause = (ms) => new Promise(res => setTimeout(res, ms));
  const threshold = cpuThreshold(settings.cpuStyle);

  logLine('CPU turn start', 'cpu');
  await pause(250);

  let tp = 0;
  let diceLeft = 6;
  let banked = false;

  for (let rollCount=1; rollCount<=8; rollCount++) {
    const values = rollDice(diceLeft);
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
      banked = true;
      break;
    }
  }

  applyTransition(transitionGame(state, { type: ACTIONS.CPU_FINISH, banked, turnPoints: tp }, settings));
}

/* Settings */
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

/* Events */
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

/* SW */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* Init */
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
