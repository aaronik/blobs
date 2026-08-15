export type BotSide = 'player' | 'enemy'

export type BotNodeState = {
  id: string
  team: BotSide | 'neutral'
  energy: number
  maxEnergy: number
  neutralInfluence: number
  position: { x: number; y: number; z: number }
}

export type BotAction = {
  type: 'send' | 'stop'
  from: string
  to: string
}

export type BotState = {
  side: BotSide
  time: number
  nodes: BotNodeState[]
  links: Array<{ from: string; to: string; active: boolean }>
}

export type ControllerConfig =
  | { kind: 'human'; name: string }
  | { kind: 'default'; name: string }
  | { kind: 'bot'; name: string; source: string }

export type SavedBot = { id: string; name: string; source: string; builtIn?: boolean }

const workerScript = `
let decide;
let sourceName = 'bot.js';
const serialize = value => {
  try { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  catch { return String(value); }
};
['log', 'warn', 'error'].forEach(level => {
  console[level] = (...args) => self.postMessage({ type: 'log', level, message: args.map(serialize).join(' ') });
});
self.onmessage = async (event) => {
  const { type, id, source, state, filename } = event.data;
  try {
    if (type === 'init') {
      sourceName = filename || 'bot.js';
      const moduleSource = source + '\\nexport { decide };\\n//# sourceURL=' + sourceName;
      const encodedSource = btoa(unescape(encodeURIComponent(moduleSource)));
      const moduleUrl = 'data:text/javascript;base64,' + encodedSource;
      const module = await import(moduleUrl);
      decide = module.decide;
      if (!decide) throw new Error('Define function decide(state)');
      self.postMessage({ type: 'ready', id });
      return;
    }
    const result = await decide(state);
    self.postMessage({ type: 'result', id, actions: Array.isArray(result) ? result : result ? [result] : [] });
  } catch (error) {
    self.postMessage({ type: 'error', id, error: String(error && error.message || error), stack: String(error && error.stack || '') });
  }
};
`

export type BotDebugEntry = {
  bot: string
  level: 'log' | 'warn' | 'error'
  message: string
  time: number
}

const reportDebug = (entry: BotDebugEntry) => {
  window.dispatchEvent(new CustomEvent<BotDebugEntry>('bot-debug', { detail: entry }))
}

export class BotRuntime {
  private worker: Worker | null = null
  private requestId = 0
  private ready = false
  private failed = false

  constructor(source: string, private name = 'Bot') {
    const url = URL.createObjectURL(new Blob([workerScript], { type: 'text/javascript' }))
    this.worker = new Worker(url)
    URL.revokeObjectURL(url)
    this.worker.onmessage = event => {
      if (event.data.type === 'ready') this.ready = true
      if (event.data.type === 'log') reportDebug({ bot: this.name, level: event.data.level, message: event.data.message, time: Date.now() })
      if (event.data.type === 'error' && event.data.id === 0) {
        this.failed = true
        const message = event.data.stack || event.data.error
        console.error(`[${this.name}] Initialization failed:`, message)
        reportDebug({ bot: this.name, level: 'error', message, time: Date.now() })
      }
    }
    const filename = `${this.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot'}.js`
    this.worker.postMessage({ type: 'init', id: 0, source, filename })
  }

  decide(state: BotState, timeoutMs = 500): Promise<BotAction[]> {
    if (!this.worker || !this.ready || this.failed) return Promise.resolve([])
    const id = ++this.requestId
    return new Promise(resolve => {
      const worker = this.worker!
      const timeout = window.setTimeout(() => {
        const message = `Decision ${id} exceeded ${timeoutMs}ms and was stopped.`
        console.error(`[${this.name}] ${message}`)
        reportDebug({ bot: this.name, level: 'error', message, time: Date.now() })
        worker.terminate()
        this.worker = null
        this.failed = true
        resolve([])
      }, timeoutMs)
      const listener = (event: MessageEvent) => {
        if (event.data.id !== id || !['result', 'error'].includes(event.data.type)) return
        window.clearTimeout(timeout)
        worker.removeEventListener('message', listener)
        if (event.data.type === 'error') {
          const message = event.data.stack || event.data.error
          console.error(`[${this.name}] Decision ${id} failed:`, message)
          reportDebug({ bot: this.name, level: 'error', message, time: Date.now() })
        }
        resolve(event.data.type === 'result' ? event.data.actions : [])
      }
      worker.addEventListener('message', listener)
      worker.postMessage({ type: 'decide', id, state })
    })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}

export const EXAMPLE_BOT_SOURCE = `/**
 * @typedef {'player' | 'enemy' | 'neutral'} Team
 *
 * @typedef {Object} BotNode
 * @property {string} id Unique node ID used in actions.
 * @property {Team} team Current owner.
 * @property {number} energy Current strength.
 * @property {number} maxEnergy Maximum strength.
 * @property {number} neutralInfluence Signed capture progress: positive is player, negative is enemy.
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
 * Return one action or an array of actions.
 * A node can have at most two active outputs.
 *
 * @param {BotState} state
 * @returns {BotAction | BotAction[] | null}
 */
function decide(state) {
  const mine = state.nodes
    .filter(node => node.team === state.side && node.energy > 15)
    .sort((a, b) => b.energy - a.energy);
  if (!mine.length) return [];

  const source = mine[0];
  const targets = state.nodes
    .filter(node => node.team !== state.side)
    .sort((a, b) => {
      const distance = node => Math.hypot(
        node.position.x - source.position.x,
        node.position.y - source.position.y,
        node.position.z - source.position.z
      );
      return (a.energy + distance(a)) - (b.energy + distance(b));
    });

  return targets[0]
    ? [{ type: 'send', from: source.id, to: targets[0].id }]
    : [];
}`
