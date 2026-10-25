namespace PdfStudio.UI;

public enum GuideKind { Heading, Label, Para, Bullet, Tips, Key }

/// <summary>One element of a parsed help topic. The layout fields are filled in by <see cref="GuideView"/>.</summary>
public sealed class GuideBlock
{
    public GuideKind Kind;
    public string Text = "";                    // heading / paragraph / bullet text, or the key of a shortcut row
    public string Text2 = "";                   // meaning of a shortcut row
    public List<string> Tips = new();           // consecutive "> " lines are grouped into one callout
    public bool Match;                          // contains the current search text

    // layout (design pixels already scaled; Y is measured from the top of the document)
    public int Y, H, TextH;
    public List<int> TipH = new();
    public int KeyW;
}

/// <summary>Turns a topic's mini markup into blocks (pure text work: no controls, no fonts, safe to cache).</summary>
public static class HelpParser
{
    public static List<GuideBlock> Parse(string body)
    {
        var list = new List<GuideBlock>();
        foreach (var raw in (body ?? "").Replace("\r", "").Split('\n'))
        {
            var line = raw.TrimEnd();
            if (line.Length == 0) continue;                       // spacing comes from the block margins
            if (line.StartsWith("### ")) list.Add(new GuideBlock { Kind = GuideKind.Label, Text = line[4..].ToUpperInvariant() });
            else if (line.StartsWith("## ")) list.Add(new GuideBlock { Kind = GuideKind.Heading, Text = line[3..] });
            else if (line.StartsWith("- ")) list.Add(new GuideBlock { Kind = GuideKind.Bullet, Text = line[2..] });
            else if (line.StartsWith("> "))
            {
                if (list.Count > 0 && list[^1].Kind == GuideKind.Tips) list[^1].Tips.Add(line[2..]);
                else { var b = new GuideBlock { Kind = GuideKind.Tips }; b.Tips.Add(line[2..]); list.Add(b); }
            }
            else if (line.StartsWith("|"))
            {
                var p = line.Split('|');
                list.Add(new GuideBlock { Kind = GuideKind.Key, Text = p.Length > 1 ? p[1] : "", Text2 = p.Length > 2 ? p[2] : "" });
            }
            else list.Add(new GuideBlock { Kind = GuideKind.Para, Text = line });
        }
        return list;
    }

    /// <summary>True when the block mentions the search text (two characters or more).</summary>
    public static bool Matches(GuideBlock b, string query)
    {
        if (query.Length < 2) return false;
        bool Has(string s) => s.Contains(query, StringComparison.OrdinalIgnoreCase);
        return b.Kind switch
        {
            GuideKind.Tips => b.Tips.Any(Has),
            GuideKind.Key => Has(b.Text) || Has(b.Text2),
            _ => Has(b.Text),
        };
    }

    /// <summary>The topic as plain text, for Ctrl+C.</summary>
    public static string ToPlainText(HelpTopic t)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine(t.Title).AppendLine();
        foreach (var b in Parse(t.Body))
        {
            switch (b.Kind)
            {
                case GuideKind.Heading: sb.AppendLine().AppendLine(b.Text); break;
                case GuideKind.Label: sb.AppendLine(b.Text); break;
                case GuideKind.Bullet: sb.AppendLine("  • " + b.Text); break;
                case GuideKind.Tips: foreach (var tip in b.Tips) sb.AppendLine("Tip: " + tip); break;
                case GuideKind.Key: sb.AppendLine($"  {b.Text}\t{b.Text2}"); break;
                default: sb.AppendLine(b.Text); break;
            }
        }
        return sb.ToString().TrimEnd();
    }
}
