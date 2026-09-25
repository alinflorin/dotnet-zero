import { useEffect, useState } from "react"
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import { useRegisterSW } from "virtual:pwa-register/react"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function isRunningStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function PwaPrompt() {
  const { t } = useTranslation()

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW()

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installDismissed, setInstallDismissed] = useState(false)
  const [installed, setInstalled] = useState(isRunningStandalone)

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    function handleAppInstalled() {
      setInstalled(true)
      setInstallPrompt(null)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("appinstalled", handleAppInstalled)
    }
  }, [])

  const showInstallDialog = offlineReady && !!installPrompt && !installed && !installDismissed

  async function handleInstall() {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }

  async function handleUpdate() {
    await updateServiceWorker(true)
  }

  return (
    <>
      <Dialog open={showInstallDialog}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("pwa.install.title")}</DialogTitle>
            <DialogContent>{t("pwa.install.description")}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setInstallDismissed(true)}>
                {t("pwa.install.dismiss")}
              </Button>
              <Button appearance="primary" onClick={handleInstall}>
                {t("pwa.install.confirm")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog open={needRefresh}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("pwa.update.title")}</DialogTitle>
            <DialogContent>{t("pwa.update.description")}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setNeedRefresh(false)}>
                {t("pwa.update.dismiss")}
              </Button>
              <Button appearance="primary" onClick={handleUpdate}>
                {t("pwa.update.confirm")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  )
}
