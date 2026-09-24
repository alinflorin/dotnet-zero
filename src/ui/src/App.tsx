import { useEffect } from "react"

function App() {

  useEffect(() => {
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).Blazor.start();
    })();
  }, []);

  return (
    <>
      apppppppppp
    </>
  )
}

export default App
