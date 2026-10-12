import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ThreadHistoricalQuestions } from '../src/components/Threads/ThreadHistoricalQuestions'

it('shows every recovered question and option without answer controls or claiming resolution', () => {
  render(<ThreadHistoricalQuestions questions={[{ title: 'Which branch?', options: ['Current', 'New'] }, { title: 'Anything else?', options: null }]} />)
  expect(screen.getByText('Answer not confirmed')).toBeVisible()
  expect(screen.getByText('Which branch?')).toBeVisible()
  expect(screen.getByText('Anything else?')).toBeVisible()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('radio')).toBeNull()
})
