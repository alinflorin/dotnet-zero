import { useEffect } from "react"
import { useDotNet } from "./hooks/useDotNet"

function App() {
  const { invoke } = useDotNet();

  useEffect(() => {
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).Blazor.start();
    })();
  }, []);

  const handleClick = async () => {
    const message = await invoke<string>("SayHello");
    alert(message);
  };

  return (
    <>
      apppppppppp
      <button onClick={handleClick}>Say Hello</button>
    </>
  )
}

export default App
