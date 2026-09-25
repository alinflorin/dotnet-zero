import { useEffect, useState } from "react"
import {
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Input,
} from "@fluentui/react-components"
import { useTranslation } from "react-i18next"

interface NamePromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  placeholder: string
  defaultValue?: string
  confirmLabel: string
  onSubmit: (name: string) => void
}

export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  defaultValue = "",
  confirmLabel,
  onSubmit,
}: NamePromptDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(defaultValue)

  useEffect(() => {
    if (open) setName(defaultValue)
  }, [open, defaultValue])

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed) return
            onOpenChange(false)
            onSubmit(trimmed)
          }}
        >
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
              <Input autoFocus value={name} onChange={(_, data) => setName(data.value)} placeholder={placeholder} />
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary">{t("common.cancel")}</Button>
              </DialogTrigger>
              <Button appearance="primary" type="submit" disabled={!name.trim()}>
                {confirmLabel}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  )
}
