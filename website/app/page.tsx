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
        <p className="mb-4 text-lg tracking-tight">A quiet notebook for thinking with AI.</p>
        <p className="leading-7 text-neutral-600 dark:text-neutral-300">
          Work through an idea in conversation. Write down what clicks in a
          notebook beside it. With each new turn, the previous exchange leaves
          the page. Your notes stay.
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
        <section id="the-idea" aria-labelledby="idea-heading" className="mb-10">
          <h2 id="idea-heading">Keep what you understand.</h2>
          <p>
            An explanation is easy to save and easy to forget. Verso asks you
            to choose what matters, put it in your own words, and build on it.
          </p>
          <p>
            The page stays focused on your latest exchange. Earlier turns can
            still inform the conversation, while your notebook grows into a
            record of your own understanding.
          </p>
        </section>

        <section aria-labelledby="notebook-heading" className="mb-10">
          <h2 id="notebook-heading">Make the notebook your own.</h2>
          <p>
            Type in Markdown, or write by hand on a tablet. Pan and zoom as
            your notes grow. Convert handwriting into text, with equations
            formatted in LaTeX.
          </p>
          <p>
            Select a passage or diagram to explore it, check your reasoning,
            or ask for a question to test your understanding. Give the notebook
            the whole screen while you read or watch a lecture, then bring the
            conversation back when you need it.
          </p>
        </section>

        <section id="get-started" aria-labelledby="start-heading">
          <h2 id="start-heading">Try Verso.</h2>
          <p>
            Verso is an early project you run on your own computer. Connect a
            local model, or choose a hosted provider. Your notebook is saved
            on the machine running the app.
          </p>
          <p>
            <a href={site.repository + '#get-started'}>Read the installation guide</a>
          </p>
        </section>
      </div>
    </>
  )
}

