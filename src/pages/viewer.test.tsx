import { render, screen } from '@testing-library/react'
import { appConfig } from '@/app.config'
import { ViewerPage } from './viewer'

test('shows the app name', () => {
  render(<ViewerPage />)
  expect(
    screen.getByRole('heading', { name: appConfig.name }),
  ).toBeInTheDocument()
})

test('invites the clinician to open a folder of images', () => {
  render(<ViewerPage />)
  expect(
    screen.getByRole('button', { name: /open a folder/i }),
  ).toBeInTheDocument()
  expect(screen.getByText(/drag a folder or files here/i)).toBeInTheDocument()
})

test('says that the images stay on the device', () => {
  render(<ViewerPage />)
  expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument()
})
