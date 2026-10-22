import { useEffect } from 'react'
import { Background } from './components/Background'
import { Clock } from './components/Clock'
import { ContextMenu } from './components/ContextMenu'
import { Credit } from './components/Credit'
import { SearchBox } from './components/SearchBox'
import { Weather } from './components/Weather'
import { useSettings } from './hooks/useSettings'
import { useWallpaper } from './hooks/useWallpaper'
import { useWeather } from './hooks/useWeather'
import { listSources } from './lib/providers'

export default function App() {
  const { settings, loaded, update } = useSettings()

  // `loaded` gates both pipelines: firing a fetch against the DEFAULT source
  // before we know the stored one would waste an Unsplash rate-limit slot, and
  // asking for geolocation before we know a city is configured would pop a
  // permission prompt for nothing.
  const wallpaper = useWallpaper(settings.source, loaded)
  const { weather } = useWeather(settings.place, loaded && settings.showWeather)
  const { next, prev } = wallpaper

  // Arrow keys mirror the context-menu navigation. Cheap to add and far nicer
  // than right-clicking twice to step through a few photos.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Don't hijack the keys while the search box or a menu field has focus.
      if (event.target instanceof HTMLInputElement) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowRight') next()
      else if (event.key === 'ArrowLeft') prev()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [next, prev])

  return (
    <>
      <Background src={wallpaper.src} ready={wallpaper.ready} blur={settings.blur} />

      {/* One centred column: clock, date, weather, search. Vertical rhythm
          widens as it descends so the eye settles on the time first. */}
      <main className="stage">
        <Clock showSeconds={settings.showSeconds} />
        {settings.showWeather && <Weather data={weather} />}
        {settings.showSearch && <SearchBox engine={settings.engine} />}
      </main>

      <Credit photo={wallpaper.photo} />

      <ContextMenu
        settings={settings}
        sources={listSources()}
        busy={wallpaper.busy}
        error={wallpaper.error}
        onPrev={prev}
        onNext={next}
        onUpdate={update}
      />
    </>
  )
}
