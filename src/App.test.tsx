import { render, screen } from '@testing-library/react'
import App from './App'

jest.mock('./components/canvas', () => () => <canvas />)

test('renders the game interface', () => {
  render(<App />)
  expect(screen.getByText('NEURAL FRONT')).toBeInTheDocument()
  expect(screen.getByText('CAPTURE ALL RIVAL NODES')).toBeInTheDocument()
})
