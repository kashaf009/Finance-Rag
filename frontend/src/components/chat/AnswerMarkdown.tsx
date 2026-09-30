import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  CITE_HREF_PREFIX,
  formatPage,
  formatScore,
  linkifyMarkers,
} from '@/lib/citations'
import type { Citation } from '@/types/api'

/**
 * Renders a chat answer as markdown with page markers turned into chips.
 *
 * `linkifyMarkers` rewrites `[p24, p30]` into a markdown link with a
 * `#cite:24,30` href (see lib/citations.ts), which react-markdown hands to the
 * custom `a` renderer below. Going through markdown rather than post-processing
 * the DOM means markers work inside paragraphs, list items, bold spans and
 * table cells alike.
 */
export function AnswerMarkdown({
  answer,
  citations,
}: {
  answer: string
  citations: Citation[]
}) {
  const byPage = new Map(citations.map((c) => [c.page_number, c]))

  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children, ...rest }) {
            if (href?.startsWith(CITE_HREF_PREFIX)) {
              const pages = href
                .slice(CITE_HREF_PREFIX.length)
                .split(',')
                .map((n) => Number.parseInt(n, 10))
                .filter((n) => Number.isFinite(n))

              return (
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {pages.map((page) => {
                    const citation = byPage.get(page)
                    return (
                      <span
                        key={page}
                        className="citation-chip"
                        data-cited={citation ? 'yes' : 'no'}
                        title={
                          citation
                            ? `${formatPage(page)} · cosine ${formatScore(citation.score)}`
                            : `${formatPage(page)} · no citation returned for this page`
                        }
                      >
                        {formatPage(page)}
                        {citation ? (
                          /* The spaces live inside the string, not on a flex
                             gap: gap-driven spacing vanishes from textContent,
                             so "p.30" + "0.518" copied out as "p.300.518". */
                          <span className="citation-chip-score">
                            {' '}
                            · {formatScore(citation.score)}
                          </span>
                        ) : null}
                      </span>
                    )
                  })}
                </span>
              )
            }
            return (
              <a href={href} className="prose-chat-link" target="_blank" rel="noreferrer noopener" {...rest}>
                {children}
              </a>
            )
          },
        }}
      >
        {linkifyMarkers(answer)}
      </ReactMarkdown>
    </div>
  )
}
