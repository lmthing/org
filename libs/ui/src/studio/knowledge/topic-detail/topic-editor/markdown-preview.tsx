import * as Prim from '../../../../elements/primitives/index';
import { Markdown } from '../../../../elements/content/markdown';

interface MarkdownPreviewProps {
  markdown: string
}

export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  return (
    <Prim.Box
      padding="$4"
      lineHeight="1.7"
      fontSize="$sm"
      fontFamily={'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'}
      color="$foreground"
      height="calc(100vh - 14rem)"
      overflow="auto"
      wordWrap="break-word"
    >
      <Markdown source={markdown} preset="document" />
    </Prim.Box>
  )
}
