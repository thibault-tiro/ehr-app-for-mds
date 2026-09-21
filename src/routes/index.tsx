import { createFileRoute } from '@tanstack/react-router'
import { ViewerPage } from '@/pages/viewer'

export const Route = createFileRoute('/')({ component: ViewerPage })
