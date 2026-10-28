/** Snapshot of every public topic returned by Unsplash /topics on 2026-10-28. */
export const UNSPLASH_CATEGORIES = [
  { id: 'landscape', label: '风景', group: '常用', topic: null, query: 'landscape,mountain,nature,forest' },
  { id: 'all', label: '全部随机', group: '常用', topic: null, query: null },
  { id: 'wallpapers', label: '壁纸', group: '摄影', topic: 'bo8jQKTaE0Y', query: null },
  { id: 'nature', label: '自然', group: '摄影', topic: '6sMVjTLSkeQ', query: null },
  { id: 'animals', label: '动物', group: '摄影', topic: 'Jpg6Kidl-Hk', query: null },
  { id: 'architecture-interior', label: '建筑', group: '摄影', topic: 'M8jVbLbTRws', query: null },
  { id: 'experimental', label: '实验艺术', group: '摄影', topic: 'qPYsDzvJOYc', query: null },
  { id: 'fashion-beauty', label: '时尚与美妆', group: '摄影', topic: 'S4MKLAsBB74', query: null },
  { id: 'film', label: '胶片', group: '摄影', topic: 'hmenvQhUmxM', query: null },
  { id: 'people', label: '人物', group: '摄影', topic: 'towJZFskpGg', query: null },
  { id: 'travel', label: '旅行', group: '摄影', topic: 'Fzo3zuOHN6w', query: null },
  { id: '3d-renders', label: '3D 渲染', group: '摄影', topic: 'CDwuwXJAbEw', query: null },
  { id: 'fall', label: '秋日', group: '摄影', topic: 'bk0hPaquVeE', query: null },
  { id: 'textures-patterns', label: '纹理', group: '摄影', topic: 'iUIsnVtjB0Y', query: null },
  { id: 'street-photography', label: '街头摄影', group: '摄影', topic: 'xHxYTMHLgOc', query: null },
  { id: 'illustration-award', label: '插画大奖', group: '插画', topic: 'crNmQgdzrGY', query: null },
  { id: 'illustration-wallpapers', label: '插画壁纸', group: '插画', topic: 'If65AuNOOxQ', query: null },
  { id: 'illustration-business-tech', label: '商业与科技', group: '插画', topic: 'vFcvoGKLoaw', query: null },
  { id: 'illustration-food-drink', label: '美食与饮品', group: '插画', topic: 'MXYPPfPdkcw', query: null },
  { id: 'illustration-people', label: '人物插画', group: '插画', topic: 'DJY86N98I0c', query: null },
  { id: 'illustration-nature', label: '自然插画', group: '插画', topic: 'M4lsf7LQDRA', query: null },
  { id: 'patterns', label: '图案', group: '插画', topic: 'upmleWZC83Y', query: null },
  { id: 'illustration-fall', label: '秋日插画', group: '插画', topic: 'QWPACXkZ93I', query: null },
] as const

export type UnsplashCategoryId = (typeof UNSPLASH_CATEGORIES)[number]['id']
export const DEFAULT_UNSPLASH_CATEGORY: UnsplashCategoryId = 'landscape'

export function isUnsplashCategory(value: unknown): value is UnsplashCategoryId {
  return typeof value === 'string' && UNSPLASH_CATEGORIES.some((c) => c.id === value)
}

export function getUnsplashCategory(value: string | null | undefined) {
  return UNSPLASH_CATEGORIES.find((c) => c.id === value) ?? UNSPLASH_CATEGORIES[0]
}

/** Same upstream allow-list for the extension and Worker, never arbitrary URLs. */
export function buildCategoryPhotosUrl(count: number, category: string, bucket = 0): string {
  const item = getUnsplashCategory(category)
  const amount = Math.min(30, Math.max(1, Number.isFinite(count) ? Math.floor(count) : 12))
  const url = new URL(item.topic ? `/topics/${item.topic}/photos` : '/photos/random', 'https://api.unsplash.com')
  if (item.topic) {
    url.searchParams.set('per_page', String(amount))
    url.searchParams.set('page', String(Math.max(0, Math.min(5, Math.floor(bucket))) + 1))
  } else {
    url.searchParams.set('count', String(amount))
    url.searchParams.set('orientation', 'landscape')
    url.searchParams.set('content_filter', 'high')
    if (item.query) url.searchParams.set('query', item.query)
  }
  return url.toString()
}

/** Preserve old default cache keys while isolating each new category. */
export function wallpaperScope(source: 'unsplash' | 'bing', category: UnsplashCategoryId): string {
  return source === 'unsplash' && category !== DEFAULT_UNSPLASH_CATEGORY ? `unsplash:${category}` : source
}
