import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'
import type { VFile } from 'vfile'
import 'katex/dist/katex.min.css'

// remark-math normally treats $$…$$ on one line as inline math. Keep the
// model's display-math intent without rewriting code blocks or escaped dollars.
function displayMath() {
  return (tree: Root, file: VFile) => {
    const source = String(file)
    visit(tree, 'inlineMath', node => {
      const start = node.position?.start.offset
      if (start !== undefined && source.startsWith('$$', start)) {
        node.data = { ...node.data, hProperties: { className: ['language-math', 'math-display'] } }
      }
    })
  }
}

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, displayMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, errorColor: '#b0b0b0' }]]}
    components={{
      img: ({ alt }) => <span>[Image: {alt}]</span>,
      table: ({ children }) => <div className="markdown-table" role="region" aria-label="Table" tabIndex={0}>
        <table>{children}</table>
      </div>,
      th: ({ node, ...props }) => <th scope="col" {...props} />,
    }}>
    {children}
  </ReactMarkdown>
}
