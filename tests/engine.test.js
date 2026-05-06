const assert = require('node:assert/strict');
const engine = require('../engine.js');

const cases = [
  ['single one', [1], 100],
  ['single five', [5], 50],
  ['three ones', [1,1,1], 1000],
  ['three twos', [2,2,2], 200],
  ['four of a kind', [4,4,4,4], 1000],
  ['five of a kind', [6,6,6,6,6], 2000],
  ['six of a kind', [3,3,3,3,3,3], 3000],
  ['straight', [1,2,3,4,5,6], 1500],
  ['three pairs', [1,1,2,2,3,3], 1500],
  ['four plus pair', [2,2,2,2,5,5], 1500],
  ['two triples', [2,2,2,3,3,3], 2500],
  ['combo singles and triple', [1,1,1,5], 1050]
];

for (const [name, dice, expected] of cases) {
  assert.equal(engine.scoreSelection(dice), expected, name);
}

assert.equal(engine.scoreSelection([1,2]), 0, 'selected dice must all score');
assert.equal(engine.scoreSelection([2,3,4,6]), 0, 'selection with no scoring dice scores zero');
assert.equal(engine.bestScoreForRoll([1,2]), 100, 'roll score can detect scoring subset');
assert.equal(engine.bestScoreForRoll([2,3,4,6]), 0, 'roll with no scoring subset is a Farkle');
assert.deepEqual(engine.countDice([1,1,5]), [0,2,0,0,0,1,0]);
assert.equal(engine.cpuThreshold('conservative'), 650);
assert.equal(engine.cpuThreshold('standard'), 900);
assert.equal(engine.cpuThreshold('aggressive'), 1200);

const rngA = engine.createSeededRng(1234);
const rngB = engine.createSeededRng(1234);
assert.deepEqual(engine.rollDice(12, rngA), engine.rollDice(12, rngB), 'seeded RNG is deterministic');

const state = engine.newState();
assert.equal(state.currentPlayer, 'you');
assert.equal(state.diceLeft, 6);
assert.deepEqual(state.tray, []);

const rolled = engine.transitionGame(engine.newState(), {
  type: engine.ACTIONS.ROLL,
  dice: [
    { id: 'a', value: 1 },
    { id: 'b', value: 2 }
  ]
});
assert.equal(rolled.ok, true);
assert.deepEqual(rolled.state.tray.map(d => d.value), [1,2]);

const toggled = engine.transitionGame(rolled.state, { type: engine.ACTIONS.TOGGLE_DIE, id: 'a' });
assert.equal(toggled.state.tray[0].selected, true);

const kept = engine.transitionGame(toggled.state, { type: engine.ACTIONS.KEEP }, { ...engine.DEFAULT_SETTINGS, hotDice: true });
assert.equal(kept.state.turnPoints, 100);
assert.equal(kept.state.diceLeft, 1);
assert.deepEqual(kept.state.kept, [1]);

const banked = engine.transitionGame({ ...kept.state, turnPoints: 500 }, { type: engine.ACTIONS.BANK }, engine.DEFAULT_SETTINGS);
assert.equal(banked.state.you.onBoard, true);
assert.equal(banked.state.you.score, 500);
assert.equal(banked.state.awaitingDone, true);

const done = engine.transitionGame(banked.state, { type: engine.ACTIONS.DONE }, engine.DEFAULT_SETTINGS);
assert.equal(done.state.currentPlayer, 'cpu');
assert.equal(done.events.some(event => event.type === 'cpuTurnRequested'), true);

const cpuFinished = engine.transitionGame(done.state, { type: engine.ACTIONS.CPU_FINISH, banked: true, turnPoints: 650 }, engine.DEFAULT_SETTINGS);
assert.equal(cpuFinished.state.currentPlayer, 'you');
assert.equal(cpuFinished.state.cpu.score, 650);
assert.equal(cpuFinished.state.cpu.onBoard, true);

console.log('engine tests passed');