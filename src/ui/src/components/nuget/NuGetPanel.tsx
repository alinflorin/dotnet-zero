import { useCallback, useEffect, useState } from "react"
import {
  makeStyles,
  tokens,
  Text,
  Caption1,
  Button,
  Spinner,
  Input,
  Badge,
  mergeClasses,
  Dropdown,
  Option,
} from "@fluentui/react-components"
import { SearchRegular, ArrowDownloadRegular, DeleteRegular } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback"
import type { NuGetSearchResultDto } from "../../app/project/types"

const SEARCH_DEBOUNCE_MS = 400
const PAGE_SIZE = 20

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    rowGap: tokens.spacingVerticalS,
  },
  emptyText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: "center",
    padding: tokens.spacingHorizontalM,
  },
  errorText: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalXS,
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalS,
  },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalS,
    padding: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  itemInfo: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flexGrow: 1,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  description: {
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  noShrink: {
    flexShrink: 0,
  },
})

export function NuGetPanel() {
  const styles = useStyles()
  const { t } = useTranslation()
  const project = useProject()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<NuGetSearchResultDto[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())

  const projectId = project.selectedProjectId
  const activeProject = project.projects.find((p) => p.id === projectId) ?? null

  const runSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed || !projectId) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      setError(null)
      try {
        const response = await project.searchPackages(projectId, trimmed, 0, PAGE_SIZE)
        setResults(response.results)
      } catch {
        setError(t("nuget.searchFailed"))
      } finally {
        setSearching(false)
      }
    },
    [project, projectId, t],
  )

  const [debouncedSearch] = useDebouncedCallback(runSearch, SEARCH_DEBOUNCE_MS)

  useEffect(() => {
    debouncedSearch(query)
  }, [query, debouncedSearch])

  const withPending = useCallback(
    async (id: string, action: () => Promise<void>) => {
      setPendingIds((prev) => new Set(prev).add(id))
      setError(null)
      try {
        await action()
      } catch {
        setError(t("nuget.actionFailed"))
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [t],
  )

  if (project.status !== "ready" || project.projects.length === 0 || !activeProject) {
    return <Text className={styles.emptyText}>{t("nuget.noProject")}</Text>
  }

  const installedPackages = activeProject.packages
  const directPackages = installedPackages.filter((p) => p.isDirect)
  const transitivePackages = installedPackages.filter((p) => !p.isDirect)

  return (
    <div className={styles.root}>
      {project.projects.length > 1 && (
        <Dropdown
          size="small"
          value={activeProject.name}
          selectedOptions={[activeProject.id]}
          onOptionSelect={(_, data) => data.optionValue && project.setSelectedProject(data.optionValue)}
        >
          {project.projects.map((p) => (
            <Option key={p.id} value={p.id}>
              {p.name}
            </Option>
          ))}
        </Dropdown>
      )}
      <Input
        contentBefore={<SearchRegular />}
        value={query}
        onChange={(_, data) => setQuery(data.value)}
        placeholder={t("nuget.searchPlaceholder")}
      />

      {error && <Caption1 className={styles.errorText}>{error}</Caption1>}
      {searching && <Spinner size="tiny" label={t("nuget.searching")} />}

      {!searching && query.trim() && (
        <div className={styles.section}>
          {results.length === 0 ? (
            <Caption1 className={styles.emptyText}>{t("nuget.noResults")}</Caption1>
          ) : (
            results.map((pkg) => {
              const isInstalled = installedPackages.some((p) => p.id.toLowerCase() === pkg.id.toLowerCase())
              const isPending = pendingIds.has(pkg.id)
              return (
                <div key={pkg.id} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <Text weight="semibold" size={200}>
                      {pkg.id}
                    </Text>
                    <Caption1 className={styles.muted}>{pkg.version}</Caption1>
                    {pkg.description && <Caption1 className={styles.description}>{pkg.description}</Caption1>}
                  </div>
                  <div className={styles.noShrink}>
                    {isPending ? (
                      <Spinner size="tiny" />
                    ) : isInstalled ? (
                      <Badge appearance="tint" color="success">
                        {t("nuget.installed")}
                      </Badge>
                    ) : (
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<ArrowDownloadRegular />}
                        onClick={() => void withPending(pkg.id, () => project.installPackage(projectId!, pkg.id, pkg.version))}
                      >
                        {t("nuget.install")}
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      <div className={styles.section}>
        <Text className={styles.sectionTitle}>{t("nuget.installedSection")}</Text>
        {directPackages.length === 0 ? (
          <Caption1 className={styles.emptyText}>{t("nuget.noPackages")}</Caption1>
        ) : (
          directPackages.map((pkg) => {
            const isPending = pendingIds.has(pkg.id)
            return (
              <div key={pkg.id} className={styles.item}>
                <div className={styles.itemInfo}>
                  <Text weight="semibold" size={200}>
                    {pkg.id}
                  </Text>
                  <Caption1 className={styles.muted}>{pkg.version}</Caption1>
                </div>
                <div className={styles.noShrink}>
                  {isPending ? (
                    <Spinner size="tiny" />
                  ) : (
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DeleteRegular />}
                      onClick={() => void withPending(pkg.id, () => project.uninstallPackage(projectId!, pkg.id))}
                    />
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {transitivePackages.length > 0 && (
        <div className={styles.section}>
          <Text className={styles.sectionTitle}>{t("nuget.dependenciesSection")}</Text>
          {transitivePackages.map((pkg) => (
            <div key={pkg.id} className={mergeClasses(styles.item)}>
              <div className={styles.itemInfo}>
                <Text size={200}>{pkg.id}</Text>
                <Caption1 className={styles.muted}>{pkg.version}</Caption1>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
