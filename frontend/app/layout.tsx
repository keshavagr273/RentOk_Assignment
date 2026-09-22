import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'RentOk LLM Gateway',
  description: 'Admin dashboard for the RentOk LLM Gateway — monitor usage, manage virtual keys, and track provider health.',
  icons: {
    icon: '/eazypgofficial_logo.jpg',
    shortcut: '/eazypgofficial_logo.jpg',
    apple: '/eazypgofficial_logo.jpg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
