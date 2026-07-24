import * as Prim from '../elements/primitives/index.js';
import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

export interface IdePreviewProps {
  url: string | null
}

function IdePreview({ url }: IdePreviewProps) {
  const [iframeKey, setIframeKey] = useState(0)
  const [inputValue, setInputValue] = useState('')
  const [iframeSrc, setIframeSrc] = useState<string | null>(null)

  // When server-ready URL arrives, populate address bar and iframe
  useEffect(() => {
    if (url && !iframeSrc) {
      setIframeSrc(url)
      setInputValue(url)
    }
  }, [url, iframeSrc])

  const navigate = () => {
    if (inputValue) {
      setIframeSrc(inputValue)
      setIframeKey((k) => k + 1)
    }
  }

  return (
    <Prim.Box
      height="100%"
      display="flex"
      flexDirection="column"
      backgroundColor="$background"
    >
      <Prim.Box
        display="flex"
        alignItems="center"
        gap="$1.5"
        paddingHorizontal="$2"
        paddingVertical="$1.5"
        backgroundColor="$card"
        borderBottomWidth={1}
        borderBottomColor="$border"
        flexShrink={0}
      >
        <Prim.Pressable
          display="flex"
          alignItems="center"
          justifyContent="center"
          padding="$1"
          borderRadius="$radius"
          color="$muted-foreground"
          flexShrink={0}
          hoverStyle={{ backgroundColor: '$accent', color: '$foreground' }}
          title="Refresh"
          onClick={() => setIframeKey((k) => k + 1)}
          disabled={!iframeSrc}
        >
          <RefreshCw size={13} />
        </Prim.Pressable>
        <Prim.TextField
          flexGrow={1}
          flexShrink={1}
          flexBasis="0%"
          minWidth={0}
          paddingHorizontal="$2"
          paddingVertical="$0.5"
          fontSize="$xs"
          backgroundColor="$background"
          borderWidth={1}
          borderColor="$border"
          borderRadius="$radius"
          fontFamily="monospace"
          color="$foreground"
          placeholderTextColor="$muted-foreground"
          focusStyle={{ outlineWidth: 1, outlineStyle: 'solid', outlineColor: '$primary' }}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate() }}
          placeholder="Starting dev server..."
        />
      </Prim.Box>
      {iframeSrc ? (
        <Prim.IFrame
          key={iframeKey}
          src={iframeSrc}
          flexGrow={1}
          flexShrink={1}
          flexBasis="0%"
          width="100%"
          borderWidth={0}
          backgroundColor="white"
          title="Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        />
      ) : (
        <Prim.Text
          flexGrow={1}
          flexShrink={1}
          flexBasis="0%"
          display="flex"
          alignItems="center"
          justifyContent="center"
          color="$muted-foreground"
          fontSize="$sm"
        >
          Starting dev server...
        </Prim.Text>
      )}
    </Prim.Box>
  )
}

export { IdePreview }
