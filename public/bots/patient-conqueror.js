/** Builds strength before attacking valuable weak targets. */
function decide(state) {
  const mine = state.nodes
    .filter(node => node.team === state.side)
    .sort((a, b) => b.energy - a.energy);

  const ready = mine.filter(node => node.energy >= Math.min(45, node.maxEnergy * 0.45));
  if (!ready.length) return [];

  const actions = [];
  for (const source of ready) {
    const target = state.nodes
      .filter(node => node.team !== state.side)
      .sort((a, b) => {
        const neutralBonusA = a.team === 'neutral' ? -12 : 0;
        const neutralBonusB = b.team === 'neutral' ? -12 : 0;
        return (a.energy + neutralBonusA) - (b.energy + neutralBonusB);
      })[0];
    if (target) actions.push({ type: 'send', from: source.id, to: target.id });
  }
  return actions;
}
