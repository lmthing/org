import * as Prim from '../elements/primitives/index.js';
import MonacoEditor from '@monaco-editor/react'
import { X } from 'lucide-react'

export interface IdeEditorProps {
  openFiles: string[]
  activeFile: string | null
  fileContents: Record<string, string>
  onFileSelect: (path: string) => void
  onFileClose: (path: string) => void
  onContentChange: (path: string, content: string) => void
}

const LANG_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json', html: 'html', css: 'css',
  md: 'markdown', svg: 'xml',
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANG_MAP[ext] || 'plaintext'
}

function IdeEditor({ openFiles, activeFile, fileContents, onFileSelect, onFileClose, onContentChange }: IdeEditorProps) {
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
        backgroundColor="$card"
        borderBottomWidth={1}
        borderBottomColor="$border"
        overflowX="auto"
        flexShrink={0}
      >
        {openFiles.length === 0 ? (
          <Prim.Text
            flexGrow={1}
            flexShrink={1}
            flexBasis="0%"
            display="flex"
            alignItems="center"
            justifyContent="center"
            color="$muted-foreground"
            fontSize="$sm"
            paddingVertical="0.5rem" paddingHorizontal="1rem"
          >
            Select a file to edit
          </Prim.Text>
        ) : (
          openFiles.map((file) => (
            <Prim.Box
              key={file}
              display="flex"
              alignItems="center"
              gap="$2"
              paddingHorizontal="$3"
              paddingVertical="$1.5"
              borderRightWidth={1}
              borderRightColor="$border"
              cursor="pointer"
              fontSize="$sm"
              color="$muted-foreground"
              hoverStyle={{ color: '$foreground' }}
              {...(activeFile === file ? { backgroundColor: '$background', color: '$foreground' } : {})}
              onClick={() => onFileSelect(file)}
            >
              <span>{file.split('/').pop()}</span>
              <Prim.Pressable
                padding="$0.5"
                borderRadius="$radius"
                hoverStyle={{ backgroundColor: '$accent' }}
                onClick={(e) => { e.stopPropagation(); onFileClose(file) }}
              >
                <X size={14} />
              </Prim.Pressable>
            </Prim.Box>
          ))
        )}
      </Prim.Box>
      <Prim.Box
        flexGrow={1}
        flexShrink={1}
        flexBasis="0%"
        minHeight={0}
      >
        {activeFile ? (
          <MonacoEditor
            height="100%"
            language={getLanguage(activeFile)}
            value={fileContents[activeFile] || ''}
            onChange={(value) => {
              if (value !== undefined) onContentChange(activeFile, value)
            }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              automaticLayout: true,
              tabSize: 2,
              scrollBeyondLastLine: false,
            }}
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
            No file open
          </Prim.Text>
        )}
      </Prim.Box>
    </Prim.Box>
  )
}

export { IdeEditor }
