/**
 * Workspace tool executors (list/create/delete project, read/write/delete
 * file) exposed to the LLM as OpenAI-style function tools, plus their JSON
 * schema declarations.
 */
import { useMemo } from 'react'
import type { useApp } from '@lmthing/state'

type ToolExecutorDeps = Pick<ReturnType<typeof useApp>, 'projects' | 'appFS' | 'createProject' | 'deleteProject'>

export const TOOL_DEFS = [
  { name: 'listProjects', description: 'List all projects on the user\'s compute pod.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'createProject', description: 'Create a new project.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'deleteProject', description: 'Delete a project by ID.', parameters: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] } },
  { name: 'listFiles', description: 'List all files in the virtual file system.', parameters: { type: 'object', properties: { prefix: { type: 'string' } }, required: [] } },
  { name: 'readFile', description: 'Read a file from the virtual file system.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'writeFile', description: 'Write content to a file in the virtual file system.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'deleteFile', description: 'Delete a file from the virtual file system.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
]

export function useThingToolExecutors({ projects, appFS, createProject, deleteProject }: ToolExecutorDeps) {
  return useMemo(() => ({
    listProjects: async () => {
      return { ok: true, projects: projects.map(s => ({ id: s.id, name: s.name })) }
    },
    createProject: async ({ name }: { name: string }) => {
      const created = await createProject(name)
      return { ok: true, message: `Created project "${name}" (${created.id}).` }
    },
    deleteProject: async ({ projectId }: { projectId: string }) => {
      await deleteProject(projectId)
      return { ok: true, message: `Deleted project ${projectId}.` }
    },
    listFiles: async ({ prefix }: { prefix?: string }) => {
      const allFiles = Object.keys(appFS.getSnapshot())
      const filtered = prefix ? allFiles.filter(f => f.startsWith(prefix)) : allFiles
      return { ok: true, files: filtered.slice(0, 100), total: filtered.length }
    },
    readFile: async ({ path }: { path: string }) => {
      const content = appFS.readFile(path)
      if (content === null) return { ok: false, message: `File not found: ${path}` }
      return { ok: true, path, content: content.slice(0, 4000) }
    },
    writeFile: async ({ path, content }: { path: string; content: string }) => {
      appFS.writeFile(path, content)
      return { ok: true, message: `Wrote ${content.length} chars to ${path}.` }
    },
    deleteFile: async ({ path }: { path: string }) => {
      appFS.deleteFile(path)
      return { ok: true, message: `Deleted ${path}.` }
    },
  }), [projects, appFS, createProject, deleteProject])
}
