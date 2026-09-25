// Monaco's language providers (app/monaco/language.ts) run outside the React tree and only ever see
// a Monaco model, i.e. a file id — but every backend call is now scoped to a project. This tiny
// module-level registry (kept in sync by SolutionProvider on every solution update) is how they
// look up which project a given open file belongs to.
let fileToProjectId = new Map<string, string>()

export function setFileProjectRegistry(map: Map<string, string>) {
  fileToProjectId = map
}

export function getProjectIdForFile(fileId: string): string | undefined {
  return fileToProjectId.get(fileId)
}
