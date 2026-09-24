using Microsoft.JSInterop;

namespace engine;

public static class PublicApi
{
    [JSInvokable]
    public static string SayHello()
    {
        return "Hello world";
    }
}
