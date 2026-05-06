(function initFarkleEngine(root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = engine;
  }
  root.FarkleEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createFarkleEngine() {
  const DEFAULT_SETTINGS = Object.freeze({
    minEntry: 500,
    winScore: 10000,
    hotDice: true,
    cpuStyle: 'standard'
  });

  function cpuThreshold(style) {
    if (style === 'conservative') return 650;
    if (style === 'aggressive') return 1200;
    return 900;
  }

  function createSeededRng(seed) {
    let t = seed >>> 0;
    return function seededRng() {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rollDice(n, rng = Math.random) {
    const arr = [];
    for (let i=0;i<n;i++) arr.push(1 + Math.floor(rng()*6));
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

  function scoreCounts(countsIn, options = {}) {
    const requireAllDice = options.requireAllDice === true;
    const memo = new Map();
    const keyOf = (c) => c.slice(1).join('');

    function rec(counts) {
      const key = keyOf(counts);
      if (memo.has(key)) return memo.get(key);

      const dice = totalCount(counts);
      if (dice === 0) return 0;

      let best = -Infinity;

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

      for (let f=1; f<=6; f++) {
        if (counts[f] >= 6) { const c2 = counts.slice(); c2[f]-=6; best = Math.max(best, 3000 + rec(c2)); }
        if (counts[f] >= 5) { const c2 = counts.slice(); c2[f]-=5; best = Math.max(best, 2000 + rec(c2)); }
        if (counts[f] >= 4) { const c2 = counts.slice(); c2[f]-=4; best = Math.max(best, 1000 + rec(c2)); }
      }

      for (let f=1; f<=6; f++) {
        if (counts[f] >= 3) {
          const base = (f === 1) ? 1000 : f * 100;
          const c2 = counts.slice(); c2[f]-=3;
          best = Math.max(best, base + rec(c2));
        }
      }

      if (counts[1] >= 1) { const c2 = counts.slice(); c2[1]-=1; best = Math.max(best, 100 + rec(c2)); }
      if (counts[5] >= 1) { const c2 = counts.slice(); c2[5]-=1; best = Math.max(best, 50 + rec(c2)); }

      if (best === -Infinity) best = requireAllDice ? -Infinity : 0;
      memo.set(key, best);
      return best;
    }

    const res = rec(countsIn.slice());
    return res < 0 ? 0 : res;
  }

  function bestScoreForRoll(values) {
    return scoreCounts(countDice(values));
  }

  function scoreSelection(values) {
    if (!values.length) return 0;
    return scoreCounts(countDice(values), { requireAllDice: true });
  }

  function newState() {
    return {
      currentPlayer: 'you',
      you: { score: 0, onBoard: false },
      cpu: { score: 0, onBoard: false },

      turnPoints: 0,
      diceLeft: 6,

      tray: [],
      kept: [],
      awaitingDone: false,
      gameOver: false
    };
  }

  function cpuChooseBestKeep(values) {
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

  return {
    DEFAULT_SETTINGS,
    bestScoreForRoll,
    countDice,
    cpuChooseBestKeep,
    cpuThreshold,
    createSeededRng,
    newState,
    rollDice,
    scoreCounts,
    scoreSelection,
    totalCount
  };
});