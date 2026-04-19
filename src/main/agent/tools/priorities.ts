/**
 * Centralized tool priority definitions.
 * Tools are sorted by priority descending — higher values appear first.
 * Tools without an explicit priority default to DEFAULT_PRIORITY (50).
 */
export const DEFAULT_PRIORITY = 50

export const TOOL_PRIORITIES: Record<string, number> = {
  read_file: 100,
  write_file: 80,
  patch: 70,
  bash: 60,
  powershell: 60,
  screenshot: 60,
  memory: 51,
  get_time: 50,
  todo: 50,
  cronjob: 45
}

/**
 * Get the priority for a tool by name.
 * Returns DEFAULT_PRIORITY if the tool has no explicit priority defined.
 */
export function getToolPriority(name: string): number {
  return TOOL_PRIORITIES[name] ?? DEFAULT_PRIORITY
}

export type ToolPriorityMetrics = {
  name: string
  basePriority?: number
  useCount?: number
}

export function getEffectiveToolPriority(
  name: string,
  useCount = 0,
  basePriority = getToolPriority(name)
): number {
  return basePriority + Math.max(0, Math.trunc(useCount))
}

export function compareToolPriorityMetrics(
  left: ToolPriorityMetrics,
  right: ToolPriorityMetrics
): number {
  const leftBasePriority = left.basePriority ?? getToolPriority(left.name)
  const rightBasePriority = right.basePriority ?? getToolPriority(right.name)
  const leftEffectivePriority = getEffectiveToolPriority(
    left.name,
    left.useCount ?? 0,
    leftBasePriority
  )
  const rightEffectivePriority = getEffectiveToolPriority(
    right.name,
    right.useCount ?? 0,
    rightBasePriority
  )

  if (rightEffectivePriority !== leftEffectivePriority) {
    return rightEffectivePriority - leftEffectivePriority
  }

  if (rightBasePriority !== leftBasePriority) {
    return rightBasePriority - leftBasePriority
  }

  return left.name.localeCompare(right.name)
}
