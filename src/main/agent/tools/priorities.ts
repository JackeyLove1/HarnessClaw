/**
 * Centralized tool priority definitions.
 * Tools are sorted by priority descending — higher values appear first.
 * Tools without an explicit priority default to DEFAULT_PRIORITY (50).
 */
export const DEFAULT_PRIORITY = 50

export const TOOL_PRIORITIES: Record<string, number> = {
  read_file: 100,
  search_files: 90,
  write_file: 80,
  patch: 70,
  get_time: 50
}

/**
 * Get the priority for a tool by name.
 * Returns DEFAULT_PRIORITY if the tool has no explicit priority defined.
 */
export function getToolPriority(name: string): number {
  return TOOL_PRIORITIES[name] ?? DEFAULT_PRIORITY
}
