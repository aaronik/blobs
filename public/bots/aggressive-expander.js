/** Aggressively captures the weakest nearby available nodes. */
function decide(state) {
  const mine = state.nodes
    .filter(node => node.team === state.side && node.energy >= 12)
    .sort((a, b) => b.energy - a.energy);

  const actions = [];
  for (const source of mine) {
    const targets = state.nodes
      .filter(node => node.team !== state.side)
      .sort((a, b) => {
        const distance = node => Math.hypot(
          node.position.x - source.position.x,
          node.position.y - source.position.y,
          node.position.z - source.position.z
        );
        return (a.energy + distance(a) * 1.5) - (b.energy + distance(b) * 1.5);
      });

    if (targets[0]) actions.push({ type: 'send', from: source.id, to: targets[0].id });
  }
  return actions;
}
