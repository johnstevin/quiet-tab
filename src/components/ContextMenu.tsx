import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SourceDescriptor } from '../lib/providers'
import { BLUR_MAX, BLUR_MIN } from '../lib/types'
import type { Place, Settings, SourceId } from '../lib/types'
import { geocode, shortPlaceName } from '../lib/weather'

type Props = {
  settings: Settings
  sources: SourceDescriptor[]
  busy: boolean
  error: string | null
  onPrev: () => void
  onNext: () => void
  onUpdate: (patch: Partial<Settings>) => void
  onClearHistory: () => Promise<void>
}

const EDGE_PADDING = 10
const GEOCODE_DEBOUNCE_MS = 220

function Check({ on }: { on: boolean }) {
  return <span className="menu__mark menu__check" data-on={on ? 'yes' : 'no'} />
}

/**
 * In-page right-click menu.
 *
 * Implemented in the page rather than via `chrome.contextMenus` on purpose: the
 * native API would add entries to Chrome's own menu (requiring the
 * `contextMenus` permission), cannot host a slider or a city search, and cannot
 * be styled to match. An in-page menu keeps the permission list minimal — and
 * every extra permission is a scarier install prompt.
 *
 * Dismissal rule: navigational actions (prev/next, switching wallpaper source)
 * close the menu, because the result is the whole screen changing. Live
 * adjustments (toggles, engine, blur, city) leave it open so you can see what
 * you are tuning.
 */
export function ContextMenu({
  settings,
  sources,
  busy,
  error,
  onPrev,
  onNext,
  onUpdate,
  onClearHistory,
}: Props) {
  /** Raw cursor position where the menu was requested. */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  /** Final position after clamping to the viewport. */
  const [placed, setPlaced] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  /* City picker, collapsed by default so the menu stays short. */
  const [placeOpen, setPlaceOpen] = useState(false)
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<Place[]>([])

  /** Confirms the wipe happened, since the result is otherwise invisible. */
  const [cleared, setCleared] = useState(false)

  const close = useCallback(() => {
    setAnchor(null)
    setPlaced(null)
    setPlaceOpen(false)
    setPlaceQuery('')
    setPlaceResults([])
    setCleared(false)
  }, [])

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      // Let the native menu through on links, so "open in new tab" and "copy
      // link address" still work on the attribution line.
      if (event.target instanceof Element && event.target.closest('a')) return
      event.preventDefault()
      setPlaced(null)
      setAnchor({ x: event.clientX, y: event.clientY })
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current) return
      if (event.target instanceof Node && ref.current.contains(event.target)) return
      close()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)

    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
    }
  }, [close])

  // City search. Open-Meteo's geocoder sends CORS headers, so this works on the
  // dev server too.
  useEffect(() => {
    const text = placeQuery.trim()
    if (!placeOpen || text.length === 0) {
      setPlaceResults([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await geocode(text, controller.signal)
          if (!controller.signal.aborted) setPlaceResults(found.slice(0, 4))
        } catch {
          setPlaceResults([])
        }
      })()
    }, GEOCODE_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [placeQuery, placeOpen])

  // Measure, then clamp so the menu never hangs off-screen. Runs before paint,
  // and the menu stays invisible until `placed` is set, so the correction is
  // never visible as a jump. Re-runs when the city picker expands.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const box = ref.current.getBoundingClientRect()
    setPlaced({
      x: Math.max(EDGE_PADDING, Math.min(anchor.x, window.innerWidth - box.width - EDGE_PADDING)),
      y: Math.max(EDGE_PADDING, Math.min(anchor.y, window.innerHeight - box.height - EDGE_PADDING)),
    })
  }, [anchor, placeOpen, placeResults.length])

  if (!anchor) return null

  /** Navigational: act, then dismiss. */
  const act = (action: () => void) => () => {
    action()
    close()
  }

  const placeLabel = settings.place ? shortPlaceName(settings.place.name) : '自动定位'

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label="新标签页设置"
      data-placed={placed ? 'yes' : 'no'}
      style={{ left: (placed ?? anchor).x, top: (placed ?? anchor).y }}
    >
      <button className="menu__item" role="menuitem" onClick={act(onPrev)} disabled={busy}>
        <span className="menu__mark menu__mark--glyph">‹</span>
        <span className="menu__text">上一张</span>
        <span className="menu__hint">←</span>
      </button>

      <button className="menu__item" role="menuitem" onClick={act(onNext)} disabled={busy}>
        <span className="menu__mark menu__mark--glyph">›</span>
        <span className="menu__text">下一张</span>
        <span className="menu__hint">→</span>
      </button>

      <div className="menu__sep" />
      <div className="menu__caption">图片来源</div>

      {sources.map((source) => (
        <button
          key={source.id}
          className="menu__item"
          role="menuitemradio"
          aria-checked={settings.source === source.id}
          disabled={!source.available || busy}
          onClick={act(() => onUpdate({ source: source.id as SourceId }))}
        >
          <span
            className="menu__mark menu__radio"
            data-on={settings.source === source.id ? 'yes' : 'no'}
          />
          <span className="menu__text">{source.label}</span>
          {source.unavailableHint && <span className="menu__hint">{source.unavailableHint}</span>}
        </button>
      ))}

      <div className="menu__sep" />
      <div className="menu__caption">显示</div>

      <button
        className="menu__item"
        role="menuitemcheckbox"
        aria-checked={settings.showSearch}
        onClick={() => onUpdate({ showSearch: !settings.showSearch })}
      >
        <Check on={settings.showSearch} />
        <span className="menu__text">搜索框</span>
      </button>

      <button
        className="menu__item"
        role="menuitemcheckbox"
        aria-checked={settings.showWeather}
        onClick={() => onUpdate({ showWeather: !settings.showWeather })}
      >
        <Check on={settings.showWeather} />
        <span className="menu__text">天气</span>
      </button>

      <button
        className="menu__item"
        role="menuitemcheckbox"
        aria-checked={settings.showSeconds}
        onClick={() => onUpdate({ showSeconds: !settings.showSeconds })}
      >
        <Check on={settings.showSeconds} />
        <span className="menu__text">显示秒</span>
      </button>

      <div className="menu__sep" />
      <div className="menu__caption">搜索</div>

      <button
        className="menu__item"
        role="menuitemcheckbox"
        aria-checked={settings.keepHistory}
        onClick={() => onUpdate({ keepHistory: !settings.keepHistory })}
      >
        <Check on={settings.keepHistory} />
        <span className="menu__text">记录搜索历史</span>
      </button>

      <button
        className="menu__item"
        role="menuitem"
        disabled={cleared}
        onClick={() => {
          void onClearHistory()
          setCleared(true)
        }}
      >
        <span className="menu__mark" />
        <span className="menu__text">清空搜索历史</span>
        {cleared && <span className="menu__hint">已清空</span>}
      </button>

      <div className="menu__sep" />

      <button
        className="menu__item"
        role="menuitem"
        aria-expanded={placeOpen}
        onClick={() => setPlaceOpen((open) => !open)}
      >
        <span className="menu__mark" />
        <span className="menu__text">天气位置</span>
        <span className="menu__hint">{placeLabel}</span>
        <span className="menu__chevron" data-open={placeOpen ? 'yes' : 'no'}>
          ›
        </span>
      </button>

      {placeOpen && (
        <div className="menu__panel">
          <input
            className="menu__input"
            type="text"
            value={placeQuery}
            placeholder="搜索城市，如 Seattle / 北京"
            spellCheck={false}
            autoComplete="off"
            aria-label="搜索城市"
            onChange={(event) => setPlaceQuery(event.target.value)}
          />

          {placeResults.map((result) => (
            <button
              key={`${result.lat},${result.lon}`}
              type="button"
              className="menu__result"
              onClick={() => {
                onUpdate({ place: result })
                setPlaceOpen(false)
                setPlaceQuery('')
                setPlaceResults([])
              }}
            >
              {result.name}
            </button>
          ))}

          {settings.place && (
            <button
              type="button"
              className="menu__result menu__result--reset"
              onClick={() => {
                onUpdate({ place: null })
                setPlaceOpen(false)
                setPlaceQuery('')
              }}
            >
              改回自动定位
            </button>
          )}
        </div>
      )}

      <div className="menu__sep" />

      <div className="menu__caption menu__caption--row">
        <span>背景模糊</span>
        <span className="menu__value">{settings.blur} px</span>
      </div>

      <input
        className="menu__slider"
        type="range"
        min={BLUR_MIN}
        max={BLUR_MAX}
        step={1}
        value={settings.blur}
        aria-label="背景模糊半径"
        onChange={(event) => onUpdate({ blur: Number(event.target.value) })}
      />

      {error && (
        <>
          <div className="menu__sep" />
          <div className="menu__error">{error}</div>
        </>
      )}
    </div>
  )
}
