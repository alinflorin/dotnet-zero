import { makeStyles, tokens, Text, Button, mergeClasses } from "@fluentui/react-components"
import {
  PlayRegular,
  PlayFilled,
  ArrowStepOverRegular,
  ArrowStepOverFilled,
  ArrowStepInRegular,
  ArrowStepInFilled,
  ArrowStepOutRegular,
  ArrowStepOutFilled,
  StopRegular,
  StopFilled,
  bundleIcon,
} from "@fluentui/react-icons"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useDebug } from "../../app/debug/debug-context"
import { useEditorActions, useEditorState } from "../../app/project/project-context"
import { useLog } from "../../app/panel/log-context"

const Play = bundleIcon(PlayFilled, PlayRegular)
const StepOver = bundleIcon(ArrowStepOverFilled, ArrowStepOverRegular)
const StepInto = bundleIcon(ArrowStepInFilled, ArrowStepInRegular)
const StepOut = bundleIcon(ArrowStepOutFilled, ArrowStepOutRegular)
const Stop = bundleIcon(StopFilled, StopRegular)

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalM,
    width: "100%",
  },
  toolbar: {
    display: "flex",
    columnGap: tokens.spacingHorizontalXS,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXS,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: tokens.colorNeutralForeground3,
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  frame: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    padding: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusSmall,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  frameActive: {
    backgroundColor: tokens.colorNeutralBackground3Selected,
  },
  variable: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    paddingLeft: tokens.spacingHorizontalS,
  },
})

export function DebugSidebar() {
  const styles = useStyles()
  const { t } = useTranslation()
  const { status, callStack, startDebug, continue_, stepOver, stepInto, stepOut, stop } = useDebug()
  const { openFiles } = useEditorState()
  const { setActiveFile } = useEditorActions()
  const { appendLine, clear, showChannel } = useLog()

  const jumpToFrame = (fileId: string) => {
    if (openFiles.some((f) => f.id === fileId)) setActiveFile(fileId)
  }

  const paused = status === "paused"
  const active = status === "running" || status === "starting" || status === "paused"
  const canStart = status === "idle" || status === "stopped"

  const handlePlay = useCallback(async () => {
    if (paused) {
      continue_()
      return
    }
    if (!canStart) return
    showChannel("debug")
    clear("debug")
    try {
      await startDebug()
    } catch (error) {
      appendLine("debug", String(error))
    }
  }, [paused, canStart, continue_, startDebug, appendLine, clear, showChannel])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="subtle"
          size="small"
          icon={<Play />}
          disabled={!paused && !canStart}
          onClick={handlePlay}
          title={paused ? t("debug.continue") : t("debug.start")}
        />
        <Button appearance="subtle" size="small" icon={<StepOver />} disabled={!paused} onClick={stepOver} title={t("debug.stepOver")} />
        <Button appearance="subtle" size="small" icon={<StepInto />} disabled={!paused} onClick={stepInto} title={t("debug.stepInto")} />
        <Button appearance="subtle" size="small" icon={<StepOut />} disabled={!paused} onClick={stepOut} title={t("debug.stepOut")} />
        <Button appearance="subtle" size="small" icon={<Stop />} disabled={!active} onClick={stop} title={t("debug.stop")} />
      </div>

      {!active ? (
        <Text className={styles.empty}>{t("debug.notRunning")}</Text>
      ) : (
        <>
          <div className={styles.section}>
            <Text className={styles.sectionTitle}>{t("debug.callStack")}</Text>
            {callStack.length === 0 ? (
              <Text className={styles.empty}>{status === "starting" ? t("debug.starting") : ""}</Text>
            ) : (
              callStack.map((frame, index) => (
                <div
                  key={`${frame.fileId}-${index}`}
                  className={mergeClasses(styles.frame, index === 0 && styles.frameActive)}
                  onClick={() => jumpToFrame(frame.fileId)}
                >
                  {frame.methodName} — {frame.fileId}:{frame.line}
                </div>
              ))
            )}
          </div>

          {(callStack[0]?.locals.length ?? 0) > 0 && (
            <div className={styles.section}>
              <Text className={styles.sectionTitle}>{t("debug.variables")}</Text>
              {callStack[0].locals.map((variable) => (
                <div key={variable.name} className={styles.variable}>
                  {variable.name} = {variable.preview}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
