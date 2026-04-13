import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { type ReactNode } from 'react'

interface EditorInfoDialogProps {
  triggerText: string
  title: string
  description: ReactNode
  action: {
    label: string
    variant?: ButtonProps['variant']
    onClick?: () => void
  }
}

export const EditorInfoDialog = ({
  triggerText,
  title,
  description,
  action
}: EditorInfoDialogProps): JSX.Element => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">{triggerText}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant={action.variant ?? 'outline'} onClick={action.onClick}>
              {action.label}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
