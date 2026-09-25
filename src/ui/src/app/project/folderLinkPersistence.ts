import { get, set, del } from "idb-keyval"

const LINKED_FOLDER_KEY = "zero.linkedFolderHandle"

export function saveLinkedFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return set(LINKED_FOLDER_KEY, handle)
}

export function loadLinkedFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return get<FileSystemDirectoryHandle>(LINKED_FOLDER_KEY)
}

export function clearLinkedFolderHandle(): Promise<void> {
  return del(LINKED_FOLDER_KEY)
}
