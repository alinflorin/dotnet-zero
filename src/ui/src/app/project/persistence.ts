import { get, set, del } from "idb-keyval"
import type { ProjectSnapshot } from "./types"

const STORAGE_KEY = "zero.projectSnapshot"

export function loadProjectSnapshot(): Promise<ProjectSnapshot | undefined> {
  return get<ProjectSnapshot>(STORAGE_KEY)
}

export function saveProjectSnapshot(snapshot: ProjectSnapshot): Promise<void> {
  return set(STORAGE_KEY, snapshot)
}

export function clearProjectSnapshot(): Promise<void> {
  return del(STORAGE_KEY)
}
