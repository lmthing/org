import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import * as Prim from '../../../elements/primitives'
import { BADGE_BASE } from '../../../elements/content/badge'
import { Caption } from '../../../elements/typography/caption'

interface GithubStarsProps {
  repo: string
}

interface GithubRepoData {
  stargazers_count: number
}

export function GithubStars({ repo }: GithubStarsProps) {
  const { data, isLoading, error } = useQuery<GithubRepoData>({
    queryKey: ['github-stars', repo],
    queryFn: async () => {
      const response = await fetch(`https://api.github.com/repos/${repo}`)
      if (!response.ok) throw new Error('Failed to fetch GitHub stars')
      return response.json()
    },
    staleTime: 1000 * 60 * 5,
    retry: 2,
  })

  if (error || isLoading) return null

  const stars = data?.stargazers_count ?? 0
  const formattedStars = stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars.toString()

  return (
    <Prim.Link href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" {...BADGE_BASE}>
      <Star size={16} />
      <Prim.Text>{formattedStars}</Prim.Text>
      <Caption muted>stars</Caption>
    </Prim.Link>
  )
}
