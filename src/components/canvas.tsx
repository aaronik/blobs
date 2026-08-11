import { useEffect, useRef } from 'react'

type CanvasProps = {
  onCanvas: (canvas: HTMLCanvasElement) => void | (() => void)
}

const Canvas = ({ onCanvas }: CanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    return onCanvas(canvasRef.current) || undefined
  }, [onCanvas])

  return <canvas ref={canvasRef} className="game-canvas" tabIndex={0} />
}

export default Canvas
