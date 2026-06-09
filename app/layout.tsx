import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Script2Video — AI-powered stock video generator',
  description: 'Paste a script. Get a video. Powered by Pexels, Pixabay, YouTube and Shotstack.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
