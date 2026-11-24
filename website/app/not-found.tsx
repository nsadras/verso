import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <section className="prose">
      <h1 className="mb-6 text-2xl font-semibold tracking-tighter">Page not found.</h1>
      <p>There isn’t a page at this address.</p>
      <p><Link href="/">Return to Verso</Link></p>
    </section>
  )
}

