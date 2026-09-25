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
  Field,
} from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import type { ProjectType } from "../../app/project/types"
import { ProjectTypeSelect } from "./ProjectTypeSelect"

interface NamePromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  placeholder: string
  defaultValue?: string
  confirmLabel: string
  onSubmit: (name: string, projectType?: ProjectType) => void
  /** When set, renders a project-type dropdown alongside the name field and passes the
   * selected type as the second argument to onSubmit. */
  showProjectType?: boolean
  defaultProjectType?: ProjectType
}

export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  defaultValue = "",
  confirmLabel,
  onSubmit,
  showProjectType = false,
  defaultProjectType = "ConsoleNet10",
}: NamePromptDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(defaultValue)
  const [projectType, setProjectType] = useState<ProjectType>(defaultProjectType)

  useEffect(() => {
    if (open) {
      setName(defaultValue)
      setProjectType(defaultProjectType)
    }
  }, [open, defaultValue, defaultProjectType])

  return (
    <Dialog open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed) return
            onOpenChange(false)
            onSubmit(trimmed, showProjectType ? projectType : undefined)
          }}
        >
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
              <Input autoFocus value={name} onChange={(_, data) => setName(data.value)} placeholder={placeholder} />
              {showProjectType && (
                <Field label={t("projectType.label")} style={{ marginTop: "8px" }}>
                  <ProjectTypeSelect value={projectType} onChange={setProjectType} />
                </Field>
              )}
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
