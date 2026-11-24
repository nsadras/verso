import './global.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { GeistSans } from 'geist/font/sans'
import { Navbar } from './components/nav'
import Footer from './components/footer'
import { site } from './site'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: '%s | Verso' },
  description: site.description,
  openGraph: {
    title: site.title,
    description: site.description,
    url: site.url,
    siteName: site.name,
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: site.title,
    description: site.description,
    images: [{ url: '/opengraph-image', alt: 'Verso. A notebook for thinking with AI.' }],
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="mx-auto max-w-xl px-6 pt-8 antialiased sm:px-0">
        <a className="skip-link" href="#main">Skip to content</a>
        <Navbar />
        <main id="main" tabIndex={-1}>{children}</main>
        <Footer />
      </body>
    </html>
  )
}

