using System.IO.Compression;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;

namespace engine.Workspace;

/// <summary>
/// Resolves, downloads and caches NuGet packages directly from nuget.org's public v3 endpoints
/// (no server-side proxy), extracting the best-matching <c>lib/</c> assemblies as Roslyn
/// <see cref="MetadataReference"/>s. Dependencies declared in a package's .nuspec are installed
/// transitively and tracked so an uninstall can drop assemblies no longer required by anything.
/// </summary>
public sealed class NuGetPackageManager
{
    private const string SearchServiceUrl = "https://azuresearch-usnc.nuget.org/query";
    private const string FlatContainerBaseUrl = "https://api.nuget.org/v3-flatcontainer";

    private static readonly string[] PreferredFrameworkFolders =
    [
        "net10.0", "net9.0", "net8.0", "net7.0", "net6.0", "net5.0",
        "netstandard2.1", "netstandard2.0", "netstandard1.6", "netstandard1.3", "netstandard1.0",
    ];

    private readonly HttpClient _httpClient = new();
    private readonly Dictionary<string, InstalledPackage> _installed = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<MetadataReference> References =>
        _installed.Values.SelectMany(p => p.References).ToList();

    public IReadOnlyList<InstalledPackageDto> Installed =>
        _installed.Values
            .OrderBy(p => p.Id, StringComparer.OrdinalIgnoreCase)
            .Select(p => new InstalledPackageDto(p.Id, p.Version, p.AssemblyNames, p.IsDirect))
            .ToList();

    public IReadOnlyList<PackageReferenceSnapshot> DirectPackages =>
        _installed.Values
            .Where(p => p.IsDirect)
            .Select(p => new PackageReferenceSnapshot(p.Id, p.Version))
            .ToList();

    public void Reset() => _installed.Clear();

    public async Task<NuGetSearchResponseDto> SearchAsync(string query, int skip, int take)
    {
        var url = $"{SearchServiceUrl}?q={Uri.EscapeDataString(query)}&skip={skip}&take={take}&prerelease=false&semVerLevel=2.0.0";
        var response = await _httpClient.GetFromJsonAsync<SearchApiResponse>(url).ConfigureAwait(false);
        var results = (response?.Data ?? [])
            .Where(item => !string.IsNullOrEmpty(item.Id))
            .Select(item => new NuGetSearchResultDto(
                item.Id!,
                item.Version ?? "",
                item.Description,
                item.IconUrl,
                item.TotalDownloads,
                _installed.ContainsKey(item.Id!)))
            .ToList();

        return new NuGetSearchResponseDto(results, response?.TotalHits ?? 0);
    }

    public async Task<InstalledPackageDto> InstallAsync(string id, string? version)
    {
        var resolvedVersion = string.IsNullOrWhiteSpace(version) ? await GetLatestVersionAsync(id).ConfigureAwait(false) : version;
        await InstallCoreAsync(id, resolvedVersion, isDirect: true, dependent: null).ConfigureAwait(false);
        var package = _installed[id];
        return new InstalledPackageDto(package.Id, package.Version, package.AssemblyNames, package.IsDirect);
    }

    public async Task RestoreAsync(IReadOnlyList<PackageReferenceSnapshot> packages)
    {
        foreach (var package in packages)
            await InstallCoreAsync(package.Id, package.Version, isDirect: true, dependent: null).ConfigureAwait(false);
    }

    public void Uninstall(string id)
    {
        if (!_installed.TryGetValue(id, out var package)) return;
        package.IsDirect = false;
        RemoveIfOrphaned(package);
    }

    private void RemoveIfOrphaned(InstalledPackage package)
    {
        if (package.IsDirect || package.RequiredBy.Count > 0) return;

        _installed.Remove(package.Id);
        foreach (var other in _installed.Values.ToList())
        {
            if (other.RequiredBy.Remove(package.Id))
                RemoveIfOrphaned(other);
        }
    }

    private async Task InstallCoreAsync(string id, string version, bool isDirect, string? dependent)
    {
        if (_installed.TryGetValue(id, out var existing))
        {
            existing.IsDirect |= isDirect;
            if (dependent is not null) existing.RequiredBy.Add(dependent);
            return;
        }

        var nupkgBytes = await DownloadPackageAsync(id, version).ConfigureAwait(false);
        using var archive = new ZipArchive(new MemoryStream(nupkgBytes), ZipArchiveMode.Read);

        var (assemblyNames, references) = ExtractAssemblies(archive);
        var dependencies = ExtractDependencies(archive);

        var package = new InstalledPackage(id, version, assemblyNames, references) { IsDirect = isDirect };
        if (dependent is not null) package.RequiredBy.Add(dependent);
        _installed[id] = package;

        foreach (var (depId, depVersionRange) in dependencies)
        {
            if (_installed.TryGetValue(depId, out var alreadyInstalled))
            {
                alreadyInstalled.RequiredBy.Add(id);
                continue;
            }

            var depVersion = await ResolveVersionAsync(depId, depVersionRange).ConfigureAwait(false);
            await InstallCoreAsync(depId, depVersion, isDirect: false, dependent: id).ConfigureAwait(false);
        }
    }

    private async Task<string> GetLatestVersionAsync(string id)
    {
        var url = $"{FlatContainerBaseUrl}/{id.ToLowerInvariant()}/index.json";
        var response = await _httpClient.GetFromJsonAsync<FlatContainerVersionsResponse>(url).ConfigureAwait(false);
        var versions = response?.Versions ?? [];
        if (versions.Count == 0) throw new InvalidOperationException($"Package '{id}' was not found.");
        return versions[^1];
    }

    private async Task<string> ResolveVersionAsync(string id, string? versionRange) =>
        ParseMinVersion(versionRange) ?? await GetLatestVersionAsync(id).ConfigureAwait(false);

    private static string? ParseMinVersion(string? range)
    {
        if (string.IsNullOrWhiteSpace(range)) return null;

        var trimmed = range.Trim();
        if (trimmed.Length >= 2 && (trimmed[0] == '[' || trimmed[0] == '('))
        {
            var inner = trimmed[1..^1];
            var lowerBound = inner.Split(',')[0].Trim();
            return string.IsNullOrEmpty(lowerBound) ? null : lowerBound;
        }

        return trimmed;
    }

    private async Task<byte[]> DownloadPackageAsync(string id, string version)
    {
        var lowerId = id.ToLowerInvariant();
        var lowerVersion = version.ToLowerInvariant();
        var url = $"{FlatContainerBaseUrl}/{lowerId}/{lowerVersion}/{lowerId}.{lowerVersion}.nupkg";

        using var response = await _httpClient.GetAsync(url).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Failed to download '{id} {version}' ({(int)response.StatusCode}).");

        return await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
    }

    private static (List<string> AssemblyNames, List<MetadataReference> References) ExtractAssemblies(ZipArchive archive)
    {
        var libEntries = archive.Entries
            .Where(e => e.FullName.StartsWith("lib/", StringComparison.OrdinalIgnoreCase) && e.FullName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (libEntries.Count == 0) return ([], []);

        var byFolder = libEntries
            .GroupBy(e =>
            {
                var segments = e.FullName.Split('/', StringSplitOptions.RemoveEmptyEntries);
                return segments.Length >= 2 ? segments[1] : "";
            })
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        List<ZipArchiveEntry>? chosen = null;
        foreach (var folder in PreferredFrameworkFolders)
        {
            if (byFolder.TryGetValue(folder, out var entries))
            {
                chosen = entries;
                break;
            }
        }
        chosen ??= byFolder.Values.OrderByDescending(entries => entries.Count).FirstOrDefault();
        if (chosen is null || chosen.Count == 0) return ([], []);

        var names = new List<string>();
        var references = new List<MetadataReference>();
        foreach (var entry in chosen)
        {
            using var entryStream = entry.Open();
            using var buffer = new MemoryStream();
            entryStream.CopyTo(buffer);

            try
            {
                references.Add(MetadataReference.CreateFromImage(buffer.ToArray()));
                names.Add(Path.GetFileNameWithoutExtension(entry.Name));
            }
            catch (BadImageFormatException)
            {
                // Not a managed assembly (e.g. a native/resource file shipped under lib/) — skip it.
            }
        }

        return (names, references);
    }

    private static List<(string Id, string? VersionRange)> ExtractDependencies(ZipArchive archive)
    {
        var nuspecEntry = archive.Entries.FirstOrDefault(e =>
            e.FullName.EndsWith(".nuspec", StringComparison.OrdinalIgnoreCase) && !e.FullName.Contains('/'));
        if (nuspecEntry is null) return [];

        using var stream = nuspecEntry.Open();
        var document = XDocument.Load(stream);
        var ns = document.Root?.Name.Namespace ?? XNamespace.None;
        var dependenciesElement = document.Root?.Element(ns + "metadata")?.Element(ns + "dependencies");
        if (dependenciesElement is null) return [];

        var groups = dependenciesElement.Elements(ns + "group").ToList();
        var dependencyElements = groups.Count > 0
            ? SelectDependencyGroup(groups).Elements(ns + "dependency")
            : dependenciesElement.Elements(ns + "dependency");

        return dependencyElements
            .Select(e => (Id: (string?)e.Attribute("id"), Version: (string?)e.Attribute("version")))
            .Where(d => !string.IsNullOrEmpty(d.Id))
            .Select(d => (d.Id!, d.Version))
            .ToList();
    }

    private static XElement SelectDependencyGroup(List<XElement> groups)
    {
        var anyFrameworkGroup = groups.FirstOrDefault(g => (string?)g.Attribute("targetFramework") is null);
        if (anyFrameworkGroup is not null) return anyFrameworkGroup;

        foreach (var folder in PreferredFrameworkFolders)
        {
            var match = groups.FirstOrDefault(g =>
                string.Equals((string?)g.Attribute("targetFramework"), folder, StringComparison.OrdinalIgnoreCase));
            if (match is not null) return match;
        }

        return groups.FirstOrDefault(g =>
            ((string?)g.Attribute("targetFramework"))?.StartsWith("netstandard", StringComparison.OrdinalIgnoreCase) == true)
            ?? groups[^1];
    }

    private sealed class InstalledPackage(string id, string version, List<string> assemblyNames, List<MetadataReference> references)
    {
        public string Id { get; } = id;
        public string Version { get; } = version;
        public List<string> AssemblyNames { get; } = assemblyNames;
        public List<MetadataReference> References { get; } = references;
        public bool IsDirect { get; set; }
        public HashSet<string> RequiredBy { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class SearchApiResponse
    {
        [JsonPropertyName("totalHits")] public long TotalHits { get; set; }
        [JsonPropertyName("data")] public List<SearchApiItem>? Data { get; set; }
    }

    private sealed class SearchApiItem
    {
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("version")] public string? Version { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("iconUrl")] public string? IconUrl { get; set; }
        [JsonPropertyName("totalDownloads")] public long TotalDownloads { get; set; }
    }

    private sealed class FlatContainerVersionsResponse
    {
        [JsonPropertyName("versions")] public List<string>? Versions { get; set; }
    }
}
