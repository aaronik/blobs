import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import Canvas from './components/canvas'
import game, { GameSnapshot } from './game/game'

const initialState: GameSnapshot = {
  playerNodes: 1,
  enemyNodes: 1,
  neutralNodes: 5,
  status: 'playing',
  selected: false,
}

function App() {
  const [state, setState] = useState(initialState)
  const [gameKey, setGameKey] = useState(0)

  const onCanvas = useCallback((canvas: HTMLCanvasElement) => {
    canvas.focus()
    return game(canvas, setState)
  }, [])

  return (
    <main className="game-shell">
      <Canvas key={gameKey} onCanvas={onCanvas} />
      <header className="hud top-hud">
        <div className="brand"><span className="brand-mark" />NEURAL FRONT</div>
        <div className="score">
          <span className="score-side player"><i /> YOU&nbsp; {state.playerNodes}</span>
          <b>NODE CONTROL</b>
          <span className="score-side enemy">{state.enemyNodes}&nbsp; RIVAL <i /></span>
        </div>
        <button className="restart" onClick={() => setGameKey(key => key + 1)}>RESTART</button>
      </header>

      <section className="hud objective">
        <small>OBJECTIVE</small>
        <strong>CAPTURE ALL RIVAL NODES</strong>
        <span>{state.neutralNodes} neutral nodes remain</span>
      </section>

      <section className="hud legend">
        <span><i className="player-dot" /> Your network</span>
        <span><i className="neutral-dot" /> Unclaimed</span>
        <span><i className="enemy-dot" /> Rival network</span>
      </section>

      <footer className="hud tutorial">
        <span className="mouse">●</span>
        {state.selected ? 'NOW SELECT A TARGET NODE' : 'SELECT YOUR CYAN NODE, THEN SELECT A TARGET'}
        <span className="divider" /> DRAG TO ORBIT · SCROLL TO ZOOM
      </footer>

      {state.status !== 'playing' && createPortal(
        <section className="result">
          <div className="result-content">
            <small>TRANSMISSION COMPLETE</small>
            <h1>{state.status === 'won' ? 'NETWORK SECURED' : 'CONNECTION LOST'}</h1>
            <p>{state.status === 'won' ? 'Every node belongs to your network.' : 'The rival consumed your last node.'}</p>
            <button onClick={() => setGameKey(key => key + 1)}>PLAY AGAIN</button>
          </div>
        </section>,
        document.body,
      )}
    </main>
  )
}

export default App
