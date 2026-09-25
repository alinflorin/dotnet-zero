import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { makeStyles, tokens, Text, Input, Spinner, Button } from "@fluentui/react-components"
import { SearchRegular, DocumentRegular, DismissRegular } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"
import { useDotNet } from "../../hooks/useDotNet"
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback"
import type { ProjectFileNode } from "../../app/project/types"

interface FlatFile {
  node: ProjectFileNode
  path: string
}

interface LineMatch {
  lineNumber: number
  text: string
  matchStart: number
  matchEnd: number
}

interface FileResult {
  file: FlatFile
  matches: LineMatch[]
}

const MIN_QUERY_LENGTH = 1
const SEARCH_DEBOUNCE_MS = 300

function flattenWithPaths(nodes: ProjectFileNode[], prefix = ""): FlatFile[] {
  const result: FlatFile[] = []
  for (const node of nodes) {
    const path = prefix ? `${prefix}/${node.name}` : node.name
    if (node.kind === "file") {
      result.push({ node, path })
    } else if (node.children) {
      result.push(...flattenWithPaths(node.children, path))
    }
  }
  return result
}

function findLineMatches(content: string, query: string): LineMatch[] {
  const lowerQuery = query.toLowerCase()
  const matches: LineMatch[] = []
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const matchStart = line.toLowerCase().indexOf(lowerQuery)
    if (matchStart !== -1) {
      matches.push({ lineNumber: i + 1, text: line, matchStart, matchEnd: matchStart + query.length })
    }
  }
  return matches
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    rowGap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalXS,
  },
  input: {
    width: "100%",
  },
  summary: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    padding: `0 ${tokens.spacingHorizontalXS}`,
  },
  results: {
    flexGrow: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  fileGroup: {
    display: "flex",
    flexDirection: "column",
  },
  fileHeader: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  filePath: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  matchRow: {
    display: "flex",
    alignItems: "baseline",
    columnGap: tokens.spacingHorizontalXS,
    padding: `2px ${tokens.spacingHorizontalXS} 2px calc(${tokens.spacingHorizontalL} + ${tokens.spacingHorizontalXS})`,
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace,
    cursor: "pointer",
    overflow: "hidden",
    whiteSpace: "nowrap",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  lineNumber: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  snippet: {
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  highlight: {
    backgroundColor: tokens.colorPaletteYellowBackground2,
    color: tokens.colorNeutralForeground1,
    borderRadius: tokens.borderRadiusSmall,
  },
})

export function SearchPanel() {
  const styles = useStyles()
  const { t } = useTranslation()
  const project = useProject()
  const { invoke } = useDotNet()

  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [results, setResults] = useState<FileResult[]>([])
  const [searching, setSearching] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const contentCache = useRef<Map<string, string>>(new Map())
  const searchToken = useRef(0)

  const [debouncedSetQuery] = useDebouncedCallback((value: string) => {
    setDebouncedQuery(value)
  }, SEARCH_DEBOUNCE_MS)

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value)
      debouncedSetQuery(value)
    },
    [debouncedSetQuery],
  )

  const files = useMemo(() => (project.project ? flattenWithPaths(project.project.files) : []), [project.project])

  useEffect(() => {
    const token = ++searchToken.current

    void (async () => {
      const trimmed = debouncedQuery.trim()
      if (trimmed.length < MIN_QUERY_LENGTH || files.length === 0) {
        if (searchToken.current === token) {
          setResults([])
          setSearching(false)
        }
        return
      }

      setSearching(true)
      const fileResults: FileResult[] = []
      for (const file of files) {
        if (searchToken.current !== token) return
        let content = contentCache.current.get(file.node.id)
        if (content === undefined) {
          try {
            content = await invoke<string>("GetFileContent", file.node.id)
          } catch {
            continue
          }
          contentCache.current.set(file.node.id, content)
        }
        if (searchToken.current !== token) return
        const matches = findLineMatches(content, trimmed)
        if (matches.length > 0) {
          fileResults.push({ file, matches })
        }
      }
      if (searchToken.current === token) {
        setResults(fileResults)
        setSearching(false)
      }
    })()
  }, [debouncedQuery, files, invoke])

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0)

  return (
    <div className={styles.root}>
      <Input
        className={styles.input}
        size="small"
        contentBefore={<SearchRegular />}
        contentAfter={
          query ? (
            <Button
              appearance="transparent"
              size="small"
              icon={<DismissRegular />}
              aria-label={t("common.cancel")}
              onClick={() => {
                setQuery("")
                setDebouncedQuery("")
              }}
            />
          ) : undefined
        }
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(_, data) => handleQueryChange(data.value)}
      />
      {!project.project ? (
        <Text className={styles.summary}>{t("search.noProject")}</Text>
      ) : searching ? (
        <Spinner size="tiny" label={t("search.searching")} />
      ) : debouncedQuery.trim().length >= MIN_QUERY_LENGTH ? (
        <Text className={styles.summary}>
          {results.length === 0
            ? t("search.noResults")
            : t("search.resultCount", { count: totalMatches, files: results.length })}
        </Text>
      ) : null}
      <div className={styles.results}>
        {results.map(({ file, matches }) => {
          const isCollapsed = collapsed.has(file.node.id)
          return (
            <div key={file.node.id} className={styles.fileGroup}>
              <div className={styles.fileHeader} onClick={() => toggleCollapsed(file.node.id)}>
                <DocumentRegular />
                <span className={styles.filePath}>{file.path}</span>
              </div>
              {!isCollapsed &&
                matches.map((match) => (
                  <div
                    key={match.lineNumber}
                    className={styles.matchRow}
                    onClick={() => void project.openFile(file.node)}
                  >
                    <span className={styles.lineNumber}>{match.lineNumber}</span>
                    <span className={styles.snippet}>
                      {match.text.slice(0, match.matchStart)}
                      <span className={styles.highlight}>{match.text.slice(match.matchStart, match.matchEnd)}</span>
                      {match.text.slice(match.matchEnd)}
                    </span>
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
