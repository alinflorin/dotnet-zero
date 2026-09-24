import type { ProjectFileNode } from "./types"

export function findFirstFile(nodes: ProjectFileNode[]): ProjectFileNode | undefined {
  for (const node of nodes) {
    if (node.kind === "file") return node
    if (node.children) {
      const found = findFirstFile(node.children)
      if (found) return found
    }
  }
  return undefined
}

export function flattenFiles(nodes: ProjectFileNode[]): Map<string, ProjectFileNode> {
  const map = new Map<string, ProjectFileNode>()
  const visit = (items: ProjectFileNode[]) => {
    for (const node of items) {
      if (node.kind === "file") {
        map.set(node.id, node)
      } else if (node.children) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return map
}
