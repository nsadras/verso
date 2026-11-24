import { site } from '../site'

export default function Footer() {
  return (
    <footer className="mb-12 mt-16">
      <nav aria-label="More about Verso" className="flex flex-wrap gap-x-6 text-sm">
        <a className="quiet-link inline-flex min-h-11 items-center" href={site.repository}>GitHub</a>
        <a className="quiet-link inline-flex min-h-11 items-center" href={site.repository + '/blob/main/DEVLOG.md'}>
          Development notes
        </a>
      </nav>
    </footer>
  )
}

