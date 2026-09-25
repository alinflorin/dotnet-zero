import { get, set, del } from "idb-keyval"
import type { ProjectSnapshot, SolutionSnapshot } from "./types"

const STORAGE_KEY = "zero.solutionSnapshot"
const LEGACY_STORAGE_KEY = "zero.projectSnapshot"

export async function loadSolutionSnapshot(): Promise<SolutionSnapshot | undefined> {
  const current = await get<SolutionSnapshot>(STORAGE_KEY)
  if (current) return current

  // Upgrade path from the single-project version of this app: wrap the old snapshot as the
  // sole project of a brand-new solution, then drop the legacy key.
  const legacy = await get<ProjectSnapshot>(LEGACY_STORAGE_KEY)
  if (!legacy) return undefined

  const migrated: SolutionSnapshot = {
    id: crypto.randomUUID().replace(/-/g, ""),
    name: legacy.name,
    projects: [legacy],
    projectReferences: { [legacy.id]: [] },
    startupProjectId: legacy.id,
  }
  await set(STORAGE_KEY, migrated)
  await del(LEGACY_STORAGE_KEY)
  return migrated
}

export function saveSolutionSnapshot(snapshot: SolutionSnapshot): Promise<void> {
  return set(STORAGE_KEY, snapshot)
}

export function clearSolutionSnapshot(): Promise<void> {
  return del(STORAGE_KEY)
}
