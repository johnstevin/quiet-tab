import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useSuggest } from '../hooks/useSuggest'
import { asUrl, getEngine } from '../lib/search'
import type { EngineId } from '../lib/types'

type Props = {
  engine: EngineId
}

function MagnifierGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" />
    </svg>
  )
}

function SparkleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6L5.7 8.8l4.6-1.7z" />
      <path d="M18.6 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
    </svg>
  )
}

/**
 * Bold the completion, leave the typed prefix plain — the convention every
 * address bar uses, so the eye lands on what is new.
 */
function highlight(suggestion: string, query: string): ReactNode {
  const typed = query.trim()
  if (!typed || !suggestion.toLowerCase().startsWith(typed.toLowerCase())) return suggestion
  return (
    <>
      {suggestion.slice(0, typed.length)}
      <b>{suggestion.slice(typed.length)}</b>
    </>
  )
}

/**
 * Search box with live suggestions.
 *
 * Behaviour notes:
 *  - NOT autofocused. Autofocus would swallow the arrow keys that step through
 *    wallpapers, and a blinking cursor fights the calm. Instead, typing any
 *    printable character anywhere on the page focuses the box — Spotlight-style
 *    — so it still feels instant.
 *  - Input that looks like a URL navigates straight there instead of searching,
 *    matching what an address bar does.
 *  - The AI row is a HANDOFF to Google's AI Mode page (udm=50). Google exposes
 *    no API for AI Mode, so answers cannot be rendered here; the row opens the
 *    query in Google's own AI Mode. Shown only for engines that have an
 *    equivalent.
 */
export function SearchBox({ engine: engineId }: Props) {
  const engine = getEngine(engineId)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  /** Highlighted row, -1 = nothing highlighted (Enter uses the raw query). */
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLUListElement>(null)

  const suggestions = useSuggest(query, engineId, focused)

  const trimmed = query.trim()
  const hasAiRow = Boolean(engine.aiUrl) && trimmed.length > 0
  const rowCount = suggestions.length + (hasAiRow ? 1 : 0)
  const open = focused && rowCount > 0
  const aiIndex = suggestions.length

  // Any change to the row set invalidates the highlight.
  useEffect(() => {
    setActive(-1)
  }, [suggestions, query])

  // Keep the keyboard-selected row visible. The dropdown carries a max-height
  // backstop, so on a short window arrowing down could otherwise walk the
  // highlight out of view.
  useEffect(() => {
    if (active < 0 || !dropRef.current) return
    const rows = dropRef.current.querySelectorAll('.search__row')
    rows[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Spotlight-style: start typing anywhere and the box takes over.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // One printable character, and nothing else already has the keyboard.
      if (event.key.length !== 1) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (document.querySelector('.menu')) return

      const input = inputRef.current
      if (!input || document.activeElement === input) return
      input.focus()
      // Let the keystroke land in the input rather than being swallowed.
      setQuery((previous) => previous + event.key)
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigate = (url: string) => {
    window.location.assign(url)
  }

  const submit = (text: string, useAi = false) => {
    const value = text.trim()
    if (!value) return

    if (useAi && engine.aiUrl) {
      navigate(engine.aiUrl(value))
      return
    }

    const direct = asUrl(value)
    navigate(direct ?? engine.url(value))
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && rowCount > 0) {
      event.preventDefault()
      setActive((i) => (i + 1) % rowCount)
      return
    }

    if (event.key === 'ArrowUp' && rowCount > 0) {
      event.preventDefault()
      setActive((i) => (i <= 0 ? rowCount - 1 : i - 1))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (active >= 0 && active < suggestions.length) {
        submit(suggestions[active] ?? query)
      } else if (active === aiIndex && hasAiRow) {
        submit(query, true)
      } else {
        // Ctrl/Cmd+Enter is the keyboard route to AI Mode.
        submit(query, event.metaKey || event.ctrlKey)
      }
      return
    }

    if (event.key === 'Escape') {
      if (query) {
        setQuery('')
        setActive(-1)
      } else {
        inputRef.current?.blur()
      }
    }
  }

  return (
    <div className={`search${open ? ' is-open' : ''}${focused ? ' is-focused' : ''}`}>
      <div className="search__bar">
        <span className="search__glyph">
          <MagnifierGlyph />
        </span>

        <input
          ref={inputRef}
          className="search__input"
          type="text"
          value={query}
          placeholder={engine.placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-label="搜索"
          role="combobox"
          aria-expanded={open}
          aria-controls="search-suggestions"
          aria-autocomplete="list"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />

        {query && (
          <button
            className="search__clear"
            type="button"
            aria-label="清空"
            // Keep focus in the input so the dropdown does not collapse.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="5" y1="5" x2="19" y2="19" />
              <line x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <ul className="search__drop" id="search-suggestions" role="listbox" ref={dropRef}>
          {suggestions.map((item, index) => (
            <li key={item} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={`search__row${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => submit(item)}
              >
                <span className="search__row-glyph">
                  <MagnifierGlyph size={15} />
                </span>
                <span className="search__row-text">{highlight(item, query)}</span>
              </button>
            </li>
          ))}

          {hasAiRow && (
            <li role="option" aria-selected={active === aiIndex}>
              {suggestions.length > 0 && <div className="search__drop-sep" />}
              <button
                type="button"
                className={`search__row search__row--ai${active === aiIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(aiIndex)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => submit(query, true)}
              >
                <span className="search__row-glyph search__row-glyph--ai">
                  <SparkleGlyph size={15} />
                </span>
                <span className="search__row-text">
                  用 AI 模式搜索「{trimmed}」
                </span>
                <span className="search__row-hint">Ctrl ↵</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
