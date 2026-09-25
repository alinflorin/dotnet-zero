// The File System Access API's directory picker and permission methods are Chromium-only and
// not yet part of TypeScript's bundled DOM lib (unlike FileSystemDirectoryHandle/FileSystemFileHandle
// themselves, which lib.dom.d.ts already covers). These augmentations only add types; callers still
// have to feature-detect at runtime via `isFileSystemAccessSupported()`.

export {}

interface FileSystemPermissionDescriptor {
  mode?: "read" | "readwrite"
}

declare global {
  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: "read" | "readwrite"
    startIn?: FileSystemHandle | string
  }

  interface Window {
    showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  }
}
