using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class NuGetApi
{
    [JSInvokable]
    public static Task<NuGetSearchResponseDto> SearchPackages(string projectId, string query, int skip, int take) =>
        ProjectApi.Solution.Project(projectId).SearchPackagesAsync(query, skip, take);

    [JSInvokable]
    public static Task<ProjectDto> InstallPackage(string projectId, string id, string? version) =>
        ProjectApi.Solution.Project(projectId).InstallPackageAsync(id, version);

    [JSInvokable]
    public static ProjectDto UninstallPackage(string projectId, string id) =>
        ProjectApi.Solution.Project(projectId).UninstallPackage(id);

    [JSInvokable]
    public static IReadOnlyList<InstalledPackageDto> GetInstalledPackages(string projectId) =>
        ProjectApi.Solution.Project(projectId).GetInstalledPackages();
}
