import { useState } from "react"
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogTrigger,
  Button,
  Checkbox,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import type { ProjectDto } from "../../app/project/types"

const useStyles = makeStyles({
  list: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXS,
    minWidth: "260px",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
  },
})

interface AddReferenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  otherProjects: ProjectDto[]
  currentReferenceIds: string[]
  onSave: (referenceIds: string[]) => void
}

export function AddReferenceDialog({ open, onOpenChange, otherProjects, currentReferenceIds, onSave }: AddReferenceDialogProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentReferenceIds))

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (data.open) setSelected(new Set(currentReferenceIds))
        onOpenChange(data.open)
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("dependencies.addReferenceTitle")}</DialogTitle>
          <DialogContent>
            {otherProjects.length === 0 ? (
              <Text className={styles.empty}>{t("dependencies.noOtherProjects")}</Text>
            ) : (
              <div className={styles.list}>
                {otherProjects.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.name}
                    checked={selected.has(p.id)}
                    onChange={(_, data) => {
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (data.checked) next.add(p.id)
                        else next.delete(p.id)
                        return next
                      })
                    }}
                  />
                ))}
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="secondary">{t("common.cancel")}</Button>
            </DialogTrigger>
            <Button
              appearance="primary"
              onClick={() => {
                onSave([...selected])
                onOpenChange(false)
              }}
            >
              {t("common.save")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
