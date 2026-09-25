using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class NuGetApi
{
    [JSInvokable]
    public static Task<NuGetSearchResponseDto> SearchPackages(string query, int skip, int take) =>
        ProjectApi.Workspace.SearchPackagesAsync(query, skip, take);

    [JSInvokable]
    public static Task<ProjectDto> InstallPackage(string id, string? version) =>
        ProjectApi.Workspace.InstallPackageAsync(id, version);

    [JSInvokable]
    public static ProjectDto UninstallPackage(string id) =>
        ProjectApi.Workspace.UninstallPackage(id);

    [JSInvokable]
    public static IReadOnlyList<InstalledPackageDto> GetInstalledPackages() =>
        ProjectApi.Workspace.GetInstalledPackages();
}
