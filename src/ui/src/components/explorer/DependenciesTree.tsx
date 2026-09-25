import { useState } from "react"
import { Tree, TreeItem, TreeItemLayout, Caption1, makeStyles, tokens } from "@fluentui/react-components"
import { BoxRegular, AppsListDetailRegular, LibraryRegular } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import type { ProjectDto } from "../../app/project/types"

const useStyles = makeStyles({
  root: {
    fontSize: "12px",
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    paddingLeft: tokens.spacingHorizontalXXL,
    fontSize: "11px",
  },
})

interface DependenciesTreeProps {
  project: ProjectDto
  referencedProjectNames: string[]
}

export function DependenciesTree({ project, referencedProjectNames }: DependenciesTreeProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const directPackages = project.packages.filter((p) => p.isDirect)

  const handleOpenChange = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Tree size="small" aria-label={t("dependencies.title")} className={styles.root} openItems={open}>
      <TreeItem itemType="branch" value="deps" onOpenChange={() => handleOpenChange("deps")}>
        <TreeItemLayout iconBefore={<LibraryRegular fontSize={14} />}>{t("dependencies.title")}</TreeItemLayout>
        <Tree>
          <TreeItem itemType="branch" value="deps-packages" onOpenChange={() => handleOpenChange("deps-packages")}>
            <TreeItemLayout iconBefore={<BoxRegular fontSize={14} />}>{t("dependencies.packages")}</TreeItemLayout>
            <Tree>
              {directPackages.length === 0 ? (
                <TreeItem itemType="leaf" value="deps-packages-empty">
                  <TreeItemLayout>
                    <Caption1 className={styles.empty}>{t("dependencies.noPackages")}</Caption1>
                  </TreeItemLayout>
                </TreeItem>
              ) : (
                directPackages.map((pkg) => (
                  <TreeItem key={pkg.id} itemType="leaf" value={`deps-pkg-${pkg.id}`}>
                    <TreeItemLayout iconBefore={<BoxRegular fontSize={14} />}>
                      {pkg.id} ({pkg.version})
                    </TreeItemLayout>
                  </TreeItem>
                ))
              )}
            </Tree>
          </TreeItem>
          <TreeItem itemType="branch" value="deps-projects" onOpenChange={() => handleOpenChange("deps-projects")}>
            <TreeItemLayout iconBefore={<AppsListDetailRegular fontSize={14} />}>{t("dependencies.projects")}</TreeItemLayout>
            <Tree>
              {referencedProjectNames.length === 0 ? (
                <TreeItem itemType="leaf" value="deps-projects-empty">
                  <TreeItemLayout>
                    <Caption1 className={styles.empty}>{t("dependencies.noProjects")}</Caption1>
                  </TreeItemLayout>
                </TreeItem>
              ) : (
                referencedProjectNames.map((name) => (
                  <TreeItem key={name} itemType="leaf" value={`deps-ref-${name}`}>
                    <TreeItemLayout iconBefore={<AppsListDetailRegular fontSize={14} />}>{name}</TreeItemLayout>
                  </TreeItem>
                ))
              )}
            </Tree>
          </TreeItem>
        </Tree>
      </TreeItem>
    </Tree>
  )
}
