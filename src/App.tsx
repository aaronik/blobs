import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import Canvas from './components/canvas'
import game, { GameSnapshot } from './game/game'
import { BotDebugEntry, ControllerConfig, EXAMPLE_BOT_SOURCE, SavedBot } from './game/bots'

const initialState: GameSnapshot = { playerNodes: 1, enemyNodes: 1, neutralNodes: 5, status: 'playing', selected: false }
const BOT_STORAGE_KEY = 'neural-front-bots'
const PLAYER_CONTROLLER_KEY = 'neural-front-player-controller'
const ENEMY_CONTROLLER_KEY = 'neural-front-enemy-controller'

const loadControllerChoice = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback } catch { return fallback }
}

const loadBots = (): SavedBot[] => {
  try { return JSON.parse(localStorage.getItem(BOT_STORAGE_KEY) || '[]') } catch { return [] }
}

function App() {
  const [state, setState] = useState(initialState)
  const [gameKey, setGameKey] = useState(0)
  const [bots, setBots] = useState<SavedBot[]>(loadBots)
  const [builtInBots, setBuiltInBots] = useState<SavedBot[]>([])
  const [playerChoice, setPlayerChoice] = useState(() => loadControllerChoice(PLAYER_CONTROLLER_KEY, 'human'))
  const [enemyChoice, setEnemyChoice] = useState(() => loadControllerChoice(ENEMY_CONTROLLER_KEY, 'default'))
  const [labOpen, setLabOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [botName, setBotName] = useState('My Strategy')
  const [botSource, setBotSource] = useState(EXAMPLE_BOT_SOURCE)
  const [debugEntries, setDebugEntries] = useState<BotDebugEntry[]>([])
  const [debugOpen, setDebugOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const debugOutputRef = useRef<HTMLDivElement>(null)
  const debugWasAtBottom = useRef(true)
  const timeScaleRef = useRef(1)
  const [timeScale, setTimeScale] = useState(1)

  useEffect(() => { localStorage.setItem(BOT_STORAGE_KEY, JSON.stringify(bots)) }, [bots])
  useEffect(() => { localStorage.setItem(PLAYER_CONTROLLER_KEY, playerChoice) }, [playerChoice])
  useEffect(() => { localStorage.setItem(ENEMY_CONTROLLER_KEY, enemyChoice) }, [enemyChoice])
  useEffect(() => {
    let cancelled = false
    fetch(`${process.env.PUBLIC_URL}/bots/index.json`)
      .then(response => {
        if (!response.ok) throw new Error(`Built-in bot manifest returned ${response.status}`)
        return response.json() as Promise<Array<{ name: string; file: string }>>
      })
      .then(entries => Promise.all(entries.map(async entry => {
        const response = await fetch(`${process.env.PUBLIC_URL}/bots/${entry.file}`)
        if (!response.ok) throw new Error(`${entry.file} returned ${response.status}`)
        return { id: `builtin:${entry.file}`, name: entry.name, source: await response.text(), builtIn: true }
      })))
      .then(loaded => { if (!cancelled) setBuiltInBots(loaded) })
      .catch(error => console.error('Could not load built-in bots:', error))
    return () => { cancelled = true }
  }, [])
  const allBots = useMemo(() => [...builtInBots, ...bots], [builtInBots, bots])
  useEffect(() => {
    const handleDebug = (event: Event) => {
      const entry = (event as CustomEvent<BotDebugEntry>).detail
      setDebugEntries(entries => [...entries.slice(-199), entry])
    }
    window.addEventListener('bot-debug', handleDebug)
    return () => window.removeEventListener('bot-debug', handleDebug)
  }, [])

  useEffect(() => {
    if (!debugOpen || !debugWasAtBottom.current || !debugOutputRef.current) return
    debugOutputRef.current.scrollTop = debugOutputRef.current.scrollHeight
  }, [debugEntries, debugOpen])

  const trackDebugScroll = () => {
    const element = debugOutputRef.current
    if (!element) return
    debugWasAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
  }

  const resolveController = useCallback((choice: string, humanAllowed: boolean): ControllerConfig => {
    if (choice === 'human' && humanAllowed) return { kind: 'human', name: 'Human' }
    if (choice === 'default') return { kind: 'default', name: 'Default AI' }
    const bot = allBots.find(item => item.id === choice.replace('bot:', ''))
    return bot ? { kind: 'bot', name: bot.name, source: bot.source } : { kind: 'default', name: 'Default AI' }
  }, [allBots])

  const controllers = useMemo(() => ({
    player: resolveController(playerChoice, true),
    enemy: resolveController(enemyChoice, false),
  }), [playerChoice, enemyChoice, resolveController])

  const onCanvas = useCallback((canvas: HTMLCanvasElement) => {
    canvas.focus()
    return game(canvas, { onUpdate: setState, controllers, getTimeScale: () => timeScaleRef.current })
  }, [controllers])

  const releaseTimeScale = useCallback(() => {
    timeScaleRef.current = 1
    setTimeScale(1)
  }, [])

  useEffect(() => {
    window.addEventListener('pointerup', releaseTimeScale)
    window.addEventListener('pointercancel', releaseTimeScale)
    window.addEventListener('keyup', releaseTimeScale)
    window.addEventListener('blur', releaseTimeScale)
    return () => {
      window.removeEventListener('pointerup', releaseTimeScale)
      window.removeEventListener('pointercancel', releaseTimeScale)
      window.removeEventListener('keyup', releaseTimeScale)
      window.removeEventListener('blur', releaseTimeScale)
    }
  }, [releaseTimeScale])

  const changeTimeScale = (value: number) => {
    const next = Math.max(1, Math.min(30, Math.round(value)))
    timeScaleRef.current = next
    setTimeScale(next)
  }

  const restart = () => {
    setState(initialState)
    setGameKey(key => key + 1)
  }

  const changeController = (side: 'player' | 'enemy', value: string) => {
    side === 'player' ? setPlayerChoice(value) : setEnemyChoice(value)
    setState(initialState)
    setGameKey(key => key + 1)
  }

  const saveBot = () => {
    const name = botName.trim() || 'Untitled Bot'
    try {
      // Compile only to validate syntax; bot code executes later in an isolated Worker.
      // eslint-disable-next-line no-new-func
      new Function(botSource)
      if (!/\bfunction\s+decide\s*\(|\b(?:const|let|var)\s+decide\s*=/.test(botSource)) throw new Error('Define a function named decide(state).')
      if (editingId && !editingId.startsWith('builtin:')) setBots(items => items.map(bot => bot.id === editingId ? { ...bot, name, source: botSource } : bot))
      else {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        setBots(items => [...items, { id, name, source: botSource }])
        setEditingId(id)
      }
      setSaveStatus({ type: 'success', message: `${name} saved successfully.` })
      window.setTimeout(() => setSaveStatus(null), 3000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSaveStatus({ type: 'error', message: `Could not save: ${message}` })
    }
  }

  const newBot = () => {
    setSaveStatus(null)
    setEditingId(null)
    setBotName('My Strategy')
    setBotSource(EXAMPLE_BOT_SOURCE)
  }

  const editBot = (bot: SavedBot) => {
    setSaveStatus(null)
    setEditingId(bot.id)
    setBotName(bot.name)
    setBotSource(bot.source)
  }

  return (
    <main className="game-shell">
      <Canvas key={gameKey} onCanvas={onCanvas} />
      <header className="hud top-hud">
        <div className="brand"><span className="brand-mark" />NEURAL FRONT</div>
        <div className="score">
          <span className="score-side player"><i /> {controllers.player.name}&nbsp; {state.playerNodes}</span>
          <b>NODE CONTROL</b>
          <span className="score-side enemy">{state.enemyNodes}&nbsp; {controllers.enemy.name} <i /></span>
        </div>
        <div className="header-actions"><button onClick={() => setDebugOpen(open => !open)}>CONSOLE {debugEntries.some(entry => entry.level === 'error') ? '!' : ''}</button><button onClick={() => setLabOpen(true)}>BOT LAB</button><button onClick={restart}>RESTART</button></div>
      </header>

      <section className="hud objective">
        <small>OBJECTIVE</small><strong>CAPTURE ALL RIVAL NODES</strong><span>{state.neutralNodes} neutral nodes remain</span>
      </section>

      <section className="controller-panel">
        <label>CYAN<select value={playerChoice} onChange={event => changeController('player', event.target.value)}>
          <option value="human">Human</option><option value="default">Default AI</option>
          {allBots.map(bot => <option key={bot.id} value={`bot:${bot.id}`}>{bot.builtIn ? 'Built-in · ' : ''}{bot.name}</option>)}
        </select></label>
        <span>VS</span>
        <label>RIVAL<select value={enemyChoice} onChange={event => changeController('enemy', event.target.value)}>
          <option value="default">Default AI</option>{allBots.map(bot => <option key={bot.id} value={`bot:${bot.id}`}>{bot.builtIn ? 'Built-in · ' : ''}{bot.name}</option>)}
        </select></label>
      </section>

      <section className="time-control">
        <div><span>HOLD TO ACCELERATE</span><strong>{timeScale}×</strong></div>
        <input
          type="range"
          min="1"
          max="30"
          step="1"
          value={timeScale}
          aria-label="Simulation speed"
          onInput={event => changeTimeScale(Number(event.currentTarget.value))}
          onChange={event => changeTimeScale(Number(event.currentTarget.value))}
          onPointerUp={releaseTimeScale}
          onPointerCancel={releaseTimeScale}
          onKeyUp={releaseTimeScale}
        />
        <div className="time-ticks">{Array.from({ length: 30 }, (_, index) => <i key={index} />)}</div>
      </section>

      <footer className="hud tutorial">
        {controllers.player.kind === 'human' ? (state.selected ? 'NOW SELECT A TARGET NODE' : 'SELECT YOUR CYAN NODE, THEN SELECT A TARGET') : 'AUTONOMOUS MATCH IN PROGRESS'}
        <span className="divider" /> DRAG TO ORBIT · SCROLL TO ZOOM
      </footer>

      {debugOpen && <section className="game-debug-console">
        <header><div><strong>BOT CONSOLE</strong><span>{debugEntries.length} messages · live</span></div><div><button onClick={() => setDebugEntries([])}>CLEAR</button><button onClick={() => setDebugOpen(false)}>×</button></div></header>
        <div className="game-debug-output" ref={debugOutputRef} onScroll={trackDebugScroll}>{debugEntries.length === 0 ? <em>Run a programmed bot. console.log(), warnings, and errors will appear here live.</em> : debugEntries.map((entry, index) =>
          <pre key={`${entry.time}-${index}`} className={entry.level}><time>{new Date(entry.time).toLocaleTimeString()}</time> <b>[{entry.bot}]</b> {entry.message}</pre>
        )}</div>
      </section>}

      {labOpen && createPortal(<section className="bot-lab-backdrop">
        <div className="bot-lab">
          <header><div><small>PROGRAMMABILITY</small><h2>BOT LAB</h2></div><button onClick={() => setLabOpen(false)}>×</button></header>
          <div className="bot-lab-body">
            <aside><button className="new-bot" onClick={newBot}>+ NEW BOT</button>{allBots.map(bot => <button className={bot.id === editingId ? 'active' : ''} key={bot.id} onClick={() => editBot(bot)}>{bot.builtIn ? '◆ ' : ''}{bot.name}</button>)}</aside>
            <div className="editor">
              <input value={botName} onChange={event => setBotName(event.target.value)} aria-label="Bot name" />
              <textarea spellCheck={false} value={botSource} onChange={event => setBotSource(event.target.value)} aria-label="Bot source" />
              <div className="editor-actions">
                <p>Typed JavaScript via JSDoc. <code>decide(state)</code> returns <code>send</code>/<code>stop</code> actions. Maximum 2 outputs per node.</p>
                {saveStatus && <div className={`save-status ${saveStatus.type}`} role="status">{saveStatus.message}</div>}
                {editingId && !editingId.startsWith('builtin:') && <button className="delete" onClick={() => { setBots(items => items.filter(bot => bot.id !== editingId)); newBot() }}>DELETE</button>}
                <button className="save" onClick={saveBot}>SAVE BOT</button>
              </div>
            </div>
          </div>
        </div>
      </section>, document.body)}

      {state.status !== 'playing' && createPortal(<section className="result"><div className="result-content">
        <small>TRANSMISSION COMPLETE</small><h1>{state.status === 'won' ? 'NETWORK SECURED' : 'CONNECTION LOST'}</h1>
        <p>{state.status === 'won' ? 'Every node belongs to the cyan network.' : 'The rival consumed the last cyan node.'}</p><button onClick={restart}>PLAY AGAIN</button>
      </div></section>, document.body)}
    </main>
  )
}

export default App
