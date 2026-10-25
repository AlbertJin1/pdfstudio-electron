namespace PdfStudio.Models;

public sealed class PageSnapshot
{
    public List<PageItem> Pages { get; init; } = new();
    public List<Guid> Selected { get; init; } = new();
    public PageSnapshot Clone() => new()
    {
        Pages = Pages.Select(p => p.Clone()).ToList(),
        Selected = Selected.ToList()
    };
}
