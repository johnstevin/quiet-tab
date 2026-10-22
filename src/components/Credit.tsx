import { UNSPLASH_HOME } from '../lib/providers/unsplash'
import type { Photo } from '../lib/types'

/**
 * Photographer attribution.
 *
 * Shown for Unsplash photos only. This is not a style choice: the Unsplash API
 * Guidelines require visible attribution naming the photographer and linking
 * back to both their profile and Unsplash, and complying is a condition of API
 * access. Bing attaches no such requirement, so nothing is rendered there and
 * the page stays clean.
 *
 * Kept very low-contrast so it reads as a footnote, and lifted on hover.
 */
export function Credit({ photo }: { photo: Photo | null }) {
  if (!photo || photo.source !== 'unsplash') return null
  if (!photo.authorName) return null

  return (
    <div className="credit">
      Photo by{' '}
      {photo.authorUrl ? (
        <a className="credit__link" href={photo.authorUrl} target="_blank" rel="noreferrer noopener">
          {photo.authorName}
        </a>
      ) : (
        <span>{photo.authorName}</span>
      )}{' '}
      on{' '}
      <a className="credit__link" href={UNSPLASH_HOME} target="_blank" rel="noreferrer noopener">
        Unsplash
      </a>
    </div>
  )
}
