import * as Prim from '../elements/primitives/index.js';
import '@lmthing/css/components/computer/ide-preview.css'
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
    <Prim.Box className="ide-preview">
      <Prim.Box className="ide-preview__header">
        <Prim.Pressable
          className="ide-preview__refresh"
          title="Refresh"
          onClick={() => setIframeKey((k) => k + 1)}
          disabled={!iframeSrc}
        >
          <RefreshCw size={13} />
        </Prim.Pressable>
        <Prim.TextField
          className="ide-preview__url"
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
          className="ide-preview__iframe"
          title="Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        />
      ) : (
        <Prim.Box className="ide-preview__loading">Starting dev server...</Prim.Box>
      )}
    </Prim.Box>
  )
}

export { IdePreview }
