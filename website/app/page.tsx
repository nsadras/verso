import Image from 'next/image'
import type { Metadata } from 'next'
import { site } from './site'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default function Page() {
  return (
    <>
      <section aria-labelledby="intro-heading">
        <h1 id="intro-heading" className="mb-6 text-2xl font-semibold tracking-tighter">
          Verso
        </h1>
        <p className="mb-4 text-lg tracking-tight">A constrained LLM interface designed to encourage focus and retention</p>
        <p className="leading-7 text-neutral-600 dark:text-neutral-300">
          When everything can be saved and revisited later, it's easy to put off the process of learning and understanding. Verso
          takes a different approach from traditional LLM interfaces - explore ideas through conversation, but the only information that
          stays around is what you write down. If you've ever spent hours brainstorming and researching with an LLM, only to realize how 
          little of it actually stuck, then Verso is for you.
        </p>
      </section>

      <figure className="my-10">
        <a className="block rounded-md" href="/images/verso-notebook.png" target="_blank" rel="noopener noreferrer"
          aria-label="View the full-size Verso screenshot (opens in a new tab)">
          <Image
            src="/images/verso-notebook.png"
            alt="Verso showing a conversation about vectors and covectors beside a notebook of personal notes."
            width={1100}
            height={760}
            sizes="(max-width: 640px) calc(100vw - 48px), 576px"
            className="h-auto w-full rounded-md border border-neutral-200 dark:border-neutral-700"
            preload
          />
        </a>
        <figcaption className="mt-3 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
          A sample conversation, and the notes worth keeping. Select the image for a closer look.
        </figcaption>
      </figure>

      <div className="prose">
        <section id="get-started" aria-labelledby="start-heading">
          <h2 id="start-heading">Try Verso.</h2>
          <p>
            Verso is free, open-source, and self-hosted. Run it completely locally via Ollama, or 
            connect to a cloud model using your own API key. Use it directly in your browser, or access it from your phone
            or tablet through Tailscale.           
          </p>
          <p>
            <a href={site.repository + '#get-started'}>Get started on GitHub</a>
          </p>
        </section>
      </div>
    </>
  )
}

