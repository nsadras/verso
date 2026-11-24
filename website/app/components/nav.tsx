import Link from 'next/link'

const navItems = [
  { href: '/', label: 'verso' },
  { href: '/#the-idea', label: 'the idea' },
  { href: '/#get-started', label: 'get started' },
]

export function Navbar() {
  return (
    <header className="mb-16">
      <nav aria-label="Main navigation" className="flex flex-wrap items-center gap-x-6 text-sm tracking-tight">
        {navItems.map(({ href, label }) => (
          <Link key={href} href={href}
            className="quiet-link inline-flex min-h-11 items-center">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

