import { describe, expect, it } from 'vitest'
import { createGetTimeTool } from './get-time'
import { createReadFileTool } from './FileSystemTool'
import { createTodoTool } from './TodoTool'
import { sortToolsByUsagePriority } from './index'

describe('sortToolsByUsagePriority', () => {
  it('sorts tools by base priority plus persisted use count', () => {
    const tools = [createTodoTool(), createGetTimeTool(), createReadFileTool()]
    const sorted = sortToolsByUsagePriority(
      tools,
      new Map([
        ['todo', 60],
        ['get_time', 80],
        ['read_file', 1]
      ])
    )

    expect(sorted.map((tool) => tool.name)).toEqual(['get_time', 'read_file', 'todo'])
  })

  it('breaks ties by base priority and then tool name', () => {
    const sorted = sortToolsByUsagePriority(
      [createTodoTool(), createGetTimeTool()],
      new Map([
        ['todo', 0],
        ['get_time', 0]
      ])
    )

    expect(sorted.map((tool) => tool.name)).toEqual(['get_time', 'todo'])
  })
})
