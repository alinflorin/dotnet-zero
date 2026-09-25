import { useCallback } from "react";

declare global {
  interface Window {
    DotNet: {
      invokeMethodAsync: <T>(assemblyName: string, methodIdentifier: string, ...args: unknown[]) => Promise<T>;
    };
  }
}

const ASSEMBLY_NAME = "engine";

export function invokeDotNet<T>(methodIdentifier: string, ...args: unknown[]) {
  return window.DotNet.invokeMethodAsync<T>(ASSEMBLY_NAME, methodIdentifier, ...args);
}

export function useDotNet() {
  const invoke = useCallback(<T>(methodIdentifier: string, ...args: unknown[]) => {
    return invokeDotNet<T>(methodIdentifier, ...args);
  }, []);

  return { invoke };
}
