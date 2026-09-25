namespace engine.Workspace;

/// <summary>The project templates offered when creating a project — each maps to a target framework,
/// output kind and reference-assembly set in <see cref="ProjectWorkspace"/>.</summary>
public enum ProjectType
{
    ConsoleNet10,
    LibraryNet10,
    LibraryNetStandard20,
    LibraryNetStandard21,
    WebApiNet10,
}
