/**
 * @typedef {'player' | 'enemy' | 'neutral'} Team
 *
 * @typedef {Object} BotNode
 * @property {string} id Unique node ID used in actions.
 * @property {Team} team Current owner.
 * @property {number} energy Current strength.
 * @property {number} maxEnergy Maximum strength.
 * @property {{x: number, y: number, z: number}} position World position.
 *
 * @typedef {Object} BotLink
 * @property {string} from Source node ID.
 * @property {string} to Target node ID.
 * @property {boolean} active Whether it is still firing.
 *
 * @typedef {Object} BotState
 * @property {'player' | 'enemy'} side Your team in this match.
 * @property {number} time Seconds elapsed.
 * @property {BotNode[]} nodes All nodes in the arena.
 * @property {BotLink[]} links All active and draining links.
 *
 * @typedef {Object} BotAction
 * @property {'send' | 'stop'} type Command to perform.
 * @property {string} from A node owned by your side.
 * @property {string} to Any other node.
 */

/**
 * Called approximately once every 1.25 seconds.
 * Return one action or an array of up to six actions.
 * A node can have at most two active outputs.
 *
 * @param {BotState} state
 * @returns {BotAction | BotAction[] | null}
 */
function decide(state) {
  const sortHighestToLowest = (a, b) => b.energy - a.energy
  const bothFull = (a, b) => a.energy === a.maxEnergy && b.energy === b.maxEnergy

  const myNodes = state.nodes
    .filter(node => node.team === state.side)
    .sort(sortHighestToLowest)
    .sort((a, b) => (b.energy / b.maxEnergy) - (a.energy / a.maxEnergy))

  const neutralNodes = state.nodes
    .filter(node => node.team === 'neutral')
    .sort(sortHighestToLowest)

  const enemyNodes = state.nodes
    .filter(node => node.team !== 'neutral' && node.team !== state.side)
    .sort(sortHighestToLowest)

  const enemyIsShootingWeakestNeutral = state.links.some(link => {
    return link.from === enemyNodes[0].id && link.to === neutralNodes.toReversed()[0].id
  })

  const enemyIsShootingMe = state.links.some(link => {
    return link.from === enemyNodes[0].id && link.to === myNodes[0].id
  })

  const botActions = []

  // Clear all existing links (so it's kind of declarative)
  state.links.forEach(link => {
    if (myNodes.map(n => n.id).includes(link.from)) {
      botActions.push({ type: 'stop', from: link.from, to: link.to })
    }
  })

  if (myNodes.length === 1) {
    if (neutralNodes.length) {
      if (enemyIsShootingWeakestNeutral) {
        botActions.push({ type: 'send', from: myNodes[0].id, to: neutralNodes.toReversed()[0].id })
        botActions.push({ type: 'send', from: myNodes[0].id, to: enemyNodes[0].id})
      } else if (enemyIsShootingMe) { // TODO What to do here
        botActions.push({ type: 'send', from: myNodes[0].id, to: enemyNodes[0].id})
      } else { // Standard strategy
        botActions.push({ type: 'send', from: myNodes[0].id, to: neutralNodes.toReversed()[0].id })
      }
    } else { // We're lost
      botActions.push({ type: 'send', from: myNodes[0].id, to: enemyNodes.toReversed()[0].id })
    }
    return botActions
  }

  // Battery
  if (myNodes.length >= 2) {
    const topNodes = []
    topNodes.push(myNodes.shift())
    topNodes.push(myNodes.shift())

    botActions.push({ type: 'send', from: topNodes[0].id, to: topNodes[1].id })
    botActions.push({ type: 'send', from: topNodes[1].id, to: topNodes[0].id })

    if (!bothFull(topNodes[0], topNodes[1])) {

    }
    else if (myNodes.length && neutralNodes.length) {
      botActions.push({ type: 'send', from: topNodes[0].id, to: myNodes[0].id })
      botActions.push({ type: 'send', from: topNodes[1].id, to: neutralNodes.toReversed()[0].id })
    }
    else if (myNodes.length) {
      botActions.push({ type: 'send', from: topNodes[0].id, to: myNodes[0].id })
      // botActions.push({ type: 'send', from: topNodes[1].id, to: myNodes[0].id })
    } else if (neutralNodes.length) {
      botActions.push({ type: 'send', from: topNodes[0].id, to: neutralNodes.toReversed()[0].id })
      // botActions.push({ type: 'send', from: topNodes[1].id, to: neutralNodes.toReversed()[0].id })
    } else {
      botActions.push({ type: 'send', from: topNodes[0].id, to: enemyNodes.toReversed()[0].id })
      // botActions.push({ type: 'send', from: topNodes[1].id, to: enemyNodes.toReversed()[0].id })
    }
  }

  // In case of emergency
  const lowHealthNodes = myNodes.filter(n => n.energy < 10)
  if (lowHealthNodes.length) {
    myNodes.forEach(n => {
      botActions.push({ type: 'send', from: n.id, to: lowHealthNodes[0].id })
    })
    return botActions
  }

  // Everyone else
  if (neutralNodes.length && myNodes.length && enemyNodes.length) {
    myNodes.forEach((node) => {
      const rand = Math.ceil(Math.random() * 3)
      if (rand % 3 === 0) {
        botActions.push({ type: 'send', from: node.id, to: neutralNodes.toReversed()[0].id })
      } else if (rand % 3 === 1) {
        botActions.push({ type: 'send', from: node.id, to: enemyNodes.toReversed()[0].id })
      } else {
        botActions.push({ type: 'send', from: node.id, to: myNodes.toReversed()[0].id })
      }
    })
  }

  // Shoot at the weakest neutral node
  if (neutralNodes.length > 0) {
    myNodes.forEach((node) => {
      botActions.push({ type: 'send', from: node.id, to: neutralNodes.toReversed()[0].id })
    })
  }

  // Shoot at the weakest enemy node
  if (enemyNodes.length > 0) {
    myNodes.forEach((node) => {
      botActions.push({ type: 'send', from: node.id, to: enemyNodes.toReversed()[0].id })
    })
  }

  // console.log("state:", state)
  // console.log("myNodes:", myNodes)
  // console.log("neutralNodes:", neutralNodes)
  // console.log("enemyNodes:", enemyNodes)
  // console.log("botActions:", botActions)
  // console.log("-----------------------------------------")

  return botActions
}
