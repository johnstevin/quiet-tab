import { shortPlaceName } from '../lib/weather'
import type { Weather as WeatherData } from '../lib/weather'
import { WeatherIcon } from './WeatherIcon'

/**
 * One quiet line of weather, sitting under the date.
 *
 * Kept to three pieces — icon, temperature, condition + place — because this
 * page's whole point is calm. High/low, apparent temperature, humidity and wind
 * are all real data we already have, so they go in the tooltip rather than
 * being dropped on the floor or crowding the line.
 */
export function Weather({ data }: { data: WeatherData | null }) {
  if (!data) return null

  const details = [
    `最高 ${data.high}° / 最低 ${data.low}°`,
    `体感 ${data.apparent}°`,
    `湿度 ${data.humidity}%`,
    `风速 ${data.wind} km/h`,
  ].join(' · ')

  return (
    <div className="weather" title={details}>
      <WeatherIcon kind={data.icon} />
      <span className="weather__temp">{data.temp}°</span>
      <span className="weather__meta">
        {data.label}
        <span className="weather__sep" aria-hidden="true">
          ·
        </span>
        {shortPlaceName(data.placeName)}
      </span>
    </div>
  )
}
