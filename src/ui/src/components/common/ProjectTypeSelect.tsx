import { Dropdown, Option } from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import type { ProjectType } from "../../app/project/types"

const PROJECT_TYPES: ProjectType[] = [
  "ConsoleNet10",
  "LibraryNet10",
  "LibraryNetStandard20",
  "LibraryNetStandard21",
  "WebApiNet10",
]

interface ProjectTypeSelectProps {
  value: ProjectType
  onChange: (value: ProjectType) => void
}

export function ProjectTypeSelect({ value, onChange }: ProjectTypeSelectProps) {
  const { t } = useTranslation()

  return (
    <Dropdown
      size="small"
      value={t(`projectType.${value}`)}
      selectedOptions={[value]}
      onOptionSelect={(_, data) => data.optionValue && onChange(data.optionValue as ProjectType)}
    >
      {PROJECT_TYPES.map((type) => (
        <Option key={type} value={type}>
          {t(`projectType.${type}`)}
        </Option>
      ))}
    </Dropdown>
  )
}
