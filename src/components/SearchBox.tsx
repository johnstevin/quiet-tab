import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useSuggest } from '../hooks/useSuggest'
import { pushHistory } from '../lib/history'
import { ENGINES, ENGINE_ORDER, asUrl, getEngine } from '../lib/search'
import type { SuggestKind, Suggestion } from '../lib/search'
import type { EngineId } from '../lib/types'

type Props = {
  engine: EngineId
  keepHistory: boolean
  onEngineChange: (engine: EngineId) => void
}

/* ── glyphs ─────────────────────────────────────────────────────────────────
   Inline SVG rather than an icon font: five shapes do not justify a dependency,
   and `currentColor` lets each one tint with its row for free.
   ───────────────────────────────────────────────────────────────────────────── */

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function MagnifierGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" />
    </svg>
  )
}

/** Past search of yours. Mirrors the address bar's history rows. */
function ClockGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" />
      <polyline points="12,7.2 12,12.2 15.9,14.3" />
    </svg>
  )
}

/** The provider flagged this suggestion as a site rather than a query. */
function GlobeGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" />
      <ellipse cx="12" cy="12" rx="3.7" ry="8.4" />
      <line x1="3.7" y1="12" x2="20.3" y2="12" />
    </svg>
  )
}

function ChevronGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <polyline points="6,9.5 12,15.5 18,9.5" />
    </svg>
  )
}

function CheckGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <polyline points="5,12.6 9.4,17 19,7" />
    </svg>
  )
}

function SparkleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5l1.7 4.6 4.6 1.7-4.6 1.7L12 15.1l-1.7-4.6L5.7 8.8l4.6-1.7z" />
      <path d="M18.6 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" />
    </svg>
  )
}

function RowGlyph({ kind }: { kind: SuggestKind }) {
  if (kind === 'history') return <ClockGlyph size={18} />
  if (kind === 'navigation') return <GlobeGlyph size={18} />
  return <MagnifierGlyph size={18} />
}

/** Provider thumbnail, with a real type glyph if the image cannot load. */
function SuggestionIcon({ row }: { row: Suggestion }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!row.imageUrl || failedUrl === row.imageUrl) return <RowGlyph kind={row.kind} />
  return (
    <img
      className="search__row-image"
      src={row.imageUrl}
      alt=""
      width={24}
      height={24}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedUrl(row.imageUrl ?? null)}
    />
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
 * Search box with live suggestions, modelled on Google's dropdown.
 *
 * Structure borrowed from google.com, visual language kept from the rest of
 * this page:
 *  - the bar and the list read as ONE surface; the bar squares off its bottom
 *    corners when open and the list overlaps its border by 1px so the seam is a
 *    single hairline rather than two stacked borders
 *  - rows carry type-specific leading icons: clock for your own history, globe
 *    for navigation hits, magnifier for queries
 *  - the engine picker lives at the right-hand end of the bar
 *
 * Behaviour notes:
 *  - NOT autofocused. Autofocus would swallow the arrow keys that step through
 *    wallpapers, and a blinking cursor fights the calm. Instead, typing any
 *    printable character anywhere focuses the box — Spotlight-style.
 *  - The AI row is pinned FIRST, and is a HANDOFF to Google's AI Mode page
 *    (udm=50). Google exposes no API for AI Mode, so answers cannot be rendered
 *    here. Shown only for engines that have an equivalent.
 *  - Input that looks like a URL navigates straight there instead of searching.
 */
export function SearchBox({ engine: engineId, keepHistory, onEngineChange }: Props) {
  const engine = getEngine(engineId)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Highlighted row, -1 = nothing highlighted (Enter uses the raw query). */
  const [active, setActive] = useState(-1)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLUListElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  /**
   * Room left under the bar, in pixels.
   *
   * A fixed `max-height` cannot work here: at 1440x900 the full nine-row list
   * clears the fold with 7px to spare, but on a 768px-tall screen the same list
   * would overflow by ~76px. Measuring the actual gap is the only way to cap it
   * correctly on every window.
   */
  const [dropMax, setDropMax] = useState<number | null>(null)

  const rows = useSuggest(query, engineId, focused, keepHistory)

  const trimmed = query.trim()
  const hasAiRow = Boolean(engine.aiUrl) && trimmed.length > 0
  // The AI row is index 0 when present, so suggestions start one later.
  const offset = hasAiRow ? 1 : 0
  const rowCount = offset + rows.length
  const open = focused && rowCount > 0

  // Any change to the row set invalidates the highlight.
  useEffect(() => {
    setActive(-1)
  }, [rows, query])

  // Keep the keyboard-selected row visible. The dropdown carries a max-height
  // backstop, so on a short window arrowing down could otherwise walk the
  // highlight out of view.
  useEffect(() => {
    if (active < 0 || !dropRef.current) return
    const drop = dropRef.current
    const element = drop.querySelectorAll<HTMLElement>('.search__row')[active]
    if (!element) return
    // Scroll this list only. scrollIntoView can also move ancestor containers.
    const listBox = drop.getBoundingClientRect()
    const rowBox = element.getBoundingClientRect()
    if (rowBox.top < listBox.top) drop.scrollTop -= listBox.top - rowBox.top
    else if (rowBox.bottom > listBox.bottom) drop.scrollTop += rowBox.bottom - listBox.bottom
  }, [active])

  /**
   * Measure the space under the bar and cap the list to it.
   *
   * A fixed `max-height` cannot work: at 1440x900 a full list clears the fold
   * with a few pixels to spare, while on a 720px-tall window the same list
   * would overflow by ~76px.
   *
   * Nothing on the page moves when the list opens (see `.stage` padding in
   * main.css), so one measurement at open time is correct — no waiting for an
   * animation to settle. Re-measured on resize only.
   */
  useLayoutEffect(() => {
    if (!open) {
      setDropMax(null)
      return
    }

    /** Breathing room kept between the list and the bottom of the window. */
    const GAP = 16

    const measure = () => {
      const bar = barRef.current
      if (!bar) return
      const { bottom } = bar.getBoundingClientRect()
      setDropMax(Math.max(0, Math.round(window.innerHeight - bottom - GAP)))
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Dismiss the engine picker on an outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return

    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current) return
      if (event.target instanceof Node && pickerRef.current.contains(event.target)) return
      setPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pickerOpen])

  // Spotlight-style: start typing anywhere and the box takes over.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
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

  /**
   * Run a search.
   *
   * `await`ing the history write before navigating is deliberate: the page is
   * about to unload, and an in-flight chrome.storage write would simply be
   * lost.
   */
  const submit = async (text: string, useAi = false) => {
    const value = text.trim()
    if (!value) return

    const direct = useAi ? null : asUrl(value)

    // Record searches, not plain URL navigations — a URL is not a search term.
    if (!direct && keepHistory) await pushHistory(value)

    if (useAi && engine.aiUrl) {
      window.location.assign(engine.aiUrl(value))
      return
    }
    window.location.assign(direct ?? engine.url(value))
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
      if (hasAiRow && active === 0) {
        void submit(query, true)
      } else if (active >= offset) {
        void submit(rows[active - offset]?.text ?? query)
      } else {
        // Ctrl/Cmd+Enter is the keyboard route to AI Mode.
        void submit(query, event.metaKey || event.ctrlKey)
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

  const surfaceStyle = (
    dropMax === null ? {} : { '--drop-max': `${dropMax}px` }
  ) as CSSProperties

  return (
    <div
      className={`search${open ? ' is-open' : ''}${focused ? ' is-focused' : ''}`}
      style={surfaceStyle}
    >
      <div className="search__bar" ref={barRef}>
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
          // Keep the list up while the engine picker has the pointer.
          onBlur={() => {
            if (!pickerOpen) setFocused(false)
          }}
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
            <svg width="14" height="14" viewBox="0 0 24 24" {...strokeProps} strokeWidth={2.2} aria-hidden="true">
              <line x1="5" y1="5" x2="19" y2="19" />
              <line x1="19" y1="5" x2="5" y2="19" />
            </svg>
          </button>
        )}

        <div className="search__engine" ref={pickerRef}>
          <button
            className="search__engine-btn"
            type="button"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label={`搜索引擎：${engine.label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPickerOpen((isOpen) => !isOpen)}
          >
            <span className="search__engine-name">{engine.short}</span>
            <span className="search__engine-chevron" data-open={pickerOpen ? 'yes' : 'no'}>
              <ChevronGlyph />
            </span>
          </button>

          {pickerOpen && (
            <ul className="search__engine-menu" role="listbox" aria-label="选择搜索引擎">
              {ENGINE_ORDER.map((id) => (
                <li key={id} role="option" aria-selected={id === engineId}>
                  <button
                    type="button"
                    className={`search__engine-item${id === engineId ? ' is-on' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onEngineChange(id)
                      setPickerOpen(false)
                      inputRef.current?.focus()
                    }}
                  >
                    <span className="search__engine-item-text">{ENGINES[id].label}</span>
                    {id === engineId && (
                      <span className="search__engine-item-check">
                        <CheckGlyph />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {open && (
        <ul className="search__drop" id="search-suggestions" role="listbox" ref={dropRef}>
          {/* AI handoff, pinned first. */}
          {hasAiRow && (
            <li role="option" aria-selected={active === 0}>
              <button
                type="button"
                className={`search__row search__row--ai${active === 0 ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(0)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void submit(query, true)}
              >
                <span className="search__row-glyph search__row-glyph--ai">
                  <SparkleGlyph size={16} />
                </span>
                <span className="search__row-text">用 AI 模式搜索「{trimmed}」</span>
                <span className="search__row-hint">Ctrl ↵</span>
              </button>
            </li>
          )}

          {hasAiRow && rows.length > 0 && <li className="search__drop-sep" role="presentation" />}

          {rows.map((row, index) => {
            const position = index + offset
            return (
              <li key={`${row.kind}:${row.text}`} role="option" aria-selected={position === active}>
                <button
                  type="button"
                  className={`search__row${position === active ? ' is-active' : ''}`}
                  data-kind={row.kind}
                  data-entity={row.imageUrl || row.description ? 'yes' : 'no'}
                  data-description={row.description ? 'yes' : 'no'}
                  onMouseEnter={() => setActive(position)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void submit(row.text)}
                >
                  <span className="search__row-glyph">
                    <SuggestionIcon row={row} />
                  </span>
                  <span className="search__row-text">
                    <span className="search__row-title">{highlight(row.title ?? row.text, query)}</span>
                    {row.description && <span className="search__row-description">{row.description}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
