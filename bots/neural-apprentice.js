/**
 * Online-learning neural policy. A tiny MLP scores every legal directed edge.
 * It learns from live state changes, terminal match rewards, then runs fast
 * approximate self-play after each match. Weights are exported to localStorage.
 */
const INPUTS = 10;
const HIDDEN = 14;
let model;
let previous = null;
let epsilon = 0.16;
let games = 0;
let selfPlayGames = 0;

const randomWeight = scale => (Math.random() * 2 - 1) * scale;
const freshModel = () => ({
  w1: Array.from({ length: INPUTS * HIDDEN }, () => randomWeight(0.22)),
  b1: Array(HIDDEN).fill(0),
  w2: Array.from({ length: HIDDEN }, () => randomWeight(0.22)),
  b2: 0,
});

function learn(saved) {
  if (saved && saved.version === 1 && saved.model &&
      saved.model.w1?.length === INPUTS * HIDDEN && saved.model.w2?.length === HIDDEN) {
    model = saved.model;
    games = saved.games || 0;
    selfPlayGames = saved.selfPlayGames || 0;
    epsilon = Math.max(0.025, saved.epsilon || 0.16);
  } else model = freshModel();
  console.log(`Neural policy ready · ${games} matches · ${selfPlayGames} self-play episodes`);
}

const opponent = side => side === 'player' ? 'enemy' : 'player';
const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-12, Math.min(12, x))));

const features = (state, from, to) => {
  const foe = opponent(state.side);
  const distance = Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z) / 30;
  const active = state.links.some(link => link.active && link.from === from.id && link.to === to.id) ? 1 : 0;
  const incoming = state.links.filter(link => link.active && link.to === from.id).length / 4;
  return [
    1,
    from.energy / Math.max(1, from.maxEnergy),
    to.energy / Math.max(1, to.maxEnergy),
    to.maxEnergy / 200,
    distance,
    to.team === state.side ? 1 : 0,
    to.team === foe ? 1 : 0,
    to.team === 'neutral' ? 1 : 0,
    Math.max(-1, Math.min(1, (state.side === 'player' ? to.neutralInfluence : -to.neutralInfluence) / Math.max(1, to.maxEnergy))),
    active - incoming,
  ];
};

const forward = (x, weights = model) => {
  const hidden = Array(HIDDEN);
  for (let h = 0; h < HIDDEN; h++) {
    let sum = weights.b1[h];
    for (let i = 0; i < INPUTS; i++) sum += x[i] * weights.w1[h * INPUTS + i];
    hidden[h] = Math.tanh(sum);
  }
  let output = weights.b2;
  for (let h = 0; h < HIDDEN; h++) output += hidden[h] * weights.w2[h];
  return { hidden, value: sigmoid(output) };
};

const train = (x, target, rate = 0.018) => {
  const { hidden, value } = forward(x);
  const delta = Math.max(-1, Math.min(1, target - value)) * value * (1 - value);
  const oldW2 = model.w2.slice();
  for (let h = 0; h < HIDDEN; h++) model.w2[h] += rate * delta * hidden[h];
  model.b2 += rate * delta;
  for (let h = 0; h < HIDDEN; h++) {
    const hiddenDelta = delta * oldW2[h] * (1 - hidden[h] * hidden[h]);
    for (let i = 0; i < INPUTS; i++) model.w1[h * INPUTS + i] += rate * hiddenDelta * x[i];
    model.b1[h] += rate * hiddenDelta;
  }
};

const advantage = state => {
  const mine = state.nodes.filter(n => n.team === state.side);
  const theirs = state.nodes.filter(n => n.team === opponent(state.side));
  const energy = nodes => nodes.reduce((sum, n) => sum + n.energy / Math.max(1, n.maxEnergy), 0);
  return Math.tanh((mine.length - theirs.length) * 0.38 + (energy(mine) - energy(theirs)) * 0.08);
};

function decide(state) {
  const mine = state.nodes.filter(node => node.team === state.side && node.energy > 3);
  if (!mine.length) return [];

  const currentAdvantage = advantage(state);
  if (previous) {
    const shapedTarget = Math.max(0, Math.min(1, 0.5 + (currentAdvantage - previous.advantage) * 1.8));
    previous.features.forEach(x => train(x, shapedTarget));
  }

  const actions = [];
  const chosenFeatures = [];
  for (const from of mine) {
    const current = state.links.filter(link => link.active && link.from === from.id);
    const candidates = state.nodes.filter(to => to.id !== from.id).map(to => {
      const x = features(state, from, to);
      return { to, x, score: forward(x).value };
    }).sort((a, b) => b.score - a.score);

    const available = candidates.filter(item => !current.some(link => link.to === item.to.id));
    const pick = Math.random() < epsilon ? available[Math.floor(Math.random() * available.length)] : available[0];
    if (pick && (pick.score > 0.46 || Math.random() < epsilon)) {
      actions.push({ type: 'send', from: from.id, to: pick.to.id });
      chosenFeatures.push(pick.x);
    }
    current.forEach(link => {
      const item = candidates.find(candidate => candidate.to.id === link.to);
      if (item && item.score < 0.34) actions.push({ type: 'stop', from: from.id, to: link.to });
    });
  }
  previous = { features: chosenFeatures, advantage: currentAdvantage };
  return actions;
}

// Fast abstract self-play: the frozen checkpoint is the opponent, while the live
// network trains. This omits rendering/projectiles but preserves ownership,
// regeneration, capacities, two outputs, and neutral tug-of-war.
const cloneModel = source => JSON.parse(JSON.stringify(source));
const makeTrainingState = side => {
  const count = 7 + Math.floor(Math.random() * 6);
  const nodes = Array.from({ length: count }, (_, i) => {
    const maxEnergy = 45 + Math.floor(Math.random() * 156);
    return { id: String(i), team: i === 0 ? side : i === count - 1 ? opponent(side) : 'neutral', energy: maxEnergy, maxEnergy,
      neutralInfluence: 0, position: { x: randomWeight(11), y: randomWeight(4.5), z: randomWeight(7) } };
  });
  nodes[0].energy *= 0.5; nodes[count - 1].energy = nodes[0].energy; nodes[count - 1].maxEnergy = nodes[0].maxEnergy;
  return { side, time: 0, nodes, links: [] };
};

const policyMove = (state, weights) => {
  const actions = [];
  state.nodes.filter(n => n.team === state.side).forEach(from => {
    const ranked = state.nodes.filter(n => n !== from).map(to => ({ from, to, x: features(state, from, to) }))
      .map(item => ({ ...item, score: forward(item.x, weights).value })).sort((a, b) => b.score - a.score);
    if (ranked[0]) actions.push(ranked[0]);
  });
  return actions;
};

const selfPlay = episodes => {
  const frozen = cloneModel(model);
  for (let episode = 0; episode < episodes; episode++) {
    const state = makeTrainingState('player');
    for (let turn = 0; turn < 90; turn++) {
      for (const side of ['player', 'enemy']) {
        state.side = side;
        const moves = policyMove(state, side === 'player' ? model : frozen);
        moves.forEach(move => {
          const power = 2.2 + move.from.energy / move.from.maxEnergy * 4;
          const target = move.to;
          if (target.team === side) target.energy = Math.min(target.maxEnergy, target.energy + power);
          else if (target.team === 'neutral') {
            target.neutralInfluence += side === 'player' ? power : -power;
            if (Math.abs(target.neutralInfluence) >= target.maxEnergy) { target.team = side; target.energy = 7; }
          } else { target.energy -= power; if (target.energy <= 0) { target.team = side; target.energy = 7; } }
        });
      }
      state.nodes.filter(n => n.team !== 'neutral').forEach(n => { n.energy = Math.min(n.maxEnergy, n.energy + 0.4); });
      if (!state.nodes.some(n => n.team === 'player') || !state.nodes.some(n => n.team === 'enemy')) break;
    }
    state.side = 'player';
    const result = advantage(state) > 0 ? 1 : 0;
    policyMove(state, model).forEach(move => train(move.x, result, 0.009));
    selfPlayGames++;
  }
};

function finish(outcome) {
  const target = outcome === 'won' ? 1 : 0;
  if (previous) previous.features.forEach(x => train(x, target, 0.045));
  previous = null;
  games++;
  epsilon = Math.max(0.025, epsilon * 0.985);
  selfPlay(32);
  console.log(`Learned from ${outcome} · ${games} matches · ${selfPlayGames} self-play episodes · exploration ${(epsilon * 100).toFixed(1)}%`);
}

function exportLearning() {
  return { version: 1, model, games, selfPlayGames, epsilon, savedAt: Date.now() };
}
