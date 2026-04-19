import { z } from 'zod'
import { PERSISTENT_MEMORY_ACTIONS, PERSISTENT_MEMORY_TARGETS } from '../../memory/types'
import { lazySchema } from '../schema'

export const memoryToolInputSchema = lazySchema(() =>
  z
    .strictObject({
      action: z.enum(PERSISTENT_MEMORY_ACTIONS),
      target: z.enum(PERSISTENT_MEMORY_TARGETS),
      content: z.string().trim().optional(),
      old_text: z.string().trim().optional(),
      task_id: z.string().optional()
    })
    .superRefine((value, ctx) => {
      if ((value.action === 'add' || value.action === 'replace') && !value.content) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['content'],
          message: 'content is required for add and replace actions.'
        })
      }

      if ((value.action === 'replace' || value.action === 'remove') && !value.old_text) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['old_text'],
          message: 'old_text is required for replace and remove actions.'
        })
      }
    })
)
