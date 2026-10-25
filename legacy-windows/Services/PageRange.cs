namespace PdfStudio.Services;

/// <summary>Parses page range text such as "1-3, 5, 8-" / "odd" / "even" into zero-based indexes.</summary>
public static class PageRange
{
    public static List<int> Parse(string? text, int pageCount)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Trim().Equals("all", StringComparison.OrdinalIgnoreCase))
            return Enumerable.Range(0, pageCount).ToList();

        var result = new List<int>();
        foreach (var token in Tokens(text)) result.AddRange(ParseToken(token, pageCount));
        return result;
    }

    /// <summary>Each comma-separated token becomes its own group (used for "split by ranges").</summary>
    public static List<List<int>> ParseGroups(string text, int pageCount)
    {
        var groups = new List<List<int>>();
        foreach (var token in Tokens(text)) groups.Add(ParseToken(token, pageCount));
        if (groups.Count == 0) throw new FormatException("Enter at least one page range, e.g. 1-3, 4-6, 7.");
        return groups;
    }

    private static IEnumerable<string> Tokens(string text) =>
        text.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static List<int> ParseToken(string raw, int count)
    {
        var token = raw.Trim().ToLowerInvariant();
        var list = new List<int>();
        if (token == "odd") { for (var i = 0; i < count; i += 2) list.Add(i); return list; }
        if (token == "even") { for (var i = 1; i < count; i += 2) list.Add(i); return list; }
        if (token == "all") return Enumerable.Range(0, count).ToList();

        var dash = token.IndexOf('-');
        if (dash < 0)
        {
            list.Add(Check(Num(token), count) - 1);
            return list;
        }
        var a = dash == 0 ? 1 : Num(token[..dash]);
        var b = dash == token.Length - 1 ? count : Num(token[(dash + 1)..]);
        Check(a, count); Check(b, count);
        if (a > b) throw new FormatException($"Range \"{raw}\" runs backwards.");
        for (var i = a; i <= b; i++) list.Add(i - 1);
        return list;
    }

    private static int Num(string s) =>
        int.TryParse(s.Trim(), out var n) ? n : throw new FormatException($"\"{s.Trim()}\" is not a page number.");

    private static int Check(int n, int count) =>
        n >= 1 && n <= count ? n : throw new FormatException($"Page {n} is out of range (1–{count}).");
}
