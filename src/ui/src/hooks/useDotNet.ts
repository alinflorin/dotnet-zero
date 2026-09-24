import { useCallback } from "react";

declare global {
  interface Window {
    DotNet: {
      invokeMethodAsync: <T>(assemblyName: string, methodIdentifier: string, ...args: unknown[]) => Promise<T>;
    };
  }
}

const ASSEMBLY_NAME = "engine";

export function useDotNet() {
  const invoke = useCallback(<T>(methodIdentifier: string, ...args: unknown[]) => {
    return window.DotNet.invokeMethodAsync<T>(ASSEMBLY_NAME, methodIdentifier, ...args);
  }, []);

  return { invoke };
}
