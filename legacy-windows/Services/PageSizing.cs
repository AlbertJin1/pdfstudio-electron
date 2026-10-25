using PdfStudio.Models;

namespace PdfStudio.Services;

/// <summary>Where a page's content lands on the target page (all values in PDF points, top-left origin).</summary>
public readonly record struct PagePlacement(double PageW, double PageH, double X, double Y, double W, double H,
                                            double ClipX, double ClipY, double ClipW, double ClipH, double SX, double SY);

/// <summary>Single source of truth for "one page size for all pages": the exporter and the dialog preview both use this.</summary>
public static class PageSizing
{
    private const double MmToPt = 72.0 / 25.4;

    private static readonly (string Name, double W, double H)[] Named =
    {
        ("A3", 297, 420), ("A4", 210, 297), ("A5", 148, 210), ("B5", 176, 250),
        ("Letter", 215.9, 279.4), ("Legal", 215.9, 355.6), ("Tabloid", 279.4, 431.8)
    };

    public static (double W, double H) StandardMm(TargetPageSize s) => s switch
    {
        TargetPageSize.A3 => (297, 420), TargetPageSize.A5 => (148, 210), TargetPageSize.B5 => (176, 250),
        TargetPageSize.Letter => (215.9, 279.4), TargetPageSize.Legal => (215.9, 355.6),
        TargetPageSize.Tabloid => (279.4, 431.8), _ => (210, 297)
    };

    /// <summary>The target size in points, normalised to portrait (short side first).</summary>
    public static (double W, double H) ResolveBase(PageLayoutOptions o, IReadOnlyList<PageItem> pages)
    {
        double w, h;
        if (o.Size == TargetPageSize.SameAsFirst && pages.Count > 0)
        {
            (w, h) = pages[0].DisplaySizePt(true);
        }
        else if (o.Size == TargetPageSize.Largest && pages.Count > 0)
        {
            var best = pages[0]; var bestArea = -1.0;
            foreach (var p in pages)
            {
                var (a, b) = p.DisplaySizePt(true);
                if (a * b > bestArea) { bestArea = a * b; best = p; }
            }
            (w, h) = best.DisplaySizePt(true);
        }
        else if (o.Size == TargetPageSize.Custom)
        {
            w = o.CustomWidthMm * MmToPt; h = o.CustomHeightMm * MmToPt;
        }
        else
        {
            var (mw, mh) = StandardMm(o.Size);
            w = mw * MmToPt; h = mh * MmToPt;
        }
        return (Math.Max(10, Math.Min(w, h)), Math.Max(10, Math.Max(w, h)));
    }

    /// <summary>Places content of size cw × ch (as displayed, rotation included) on the target page.</summary>
    public static PagePlacement Place(double cw, double ch, PageLayoutOptions o, (double W, double H) b)
    {
        cw = Math.Max(1, cw); ch = Math.Max(1, ch);
        var landscape = o.Orientation switch
        {
            TargetOrientation.Landscape => true,
            TargetOrientation.Portrait => false,
            _ => cw > ch
        };
        var pw = landscape ? b.H : b.W;
        var ph = landscape ? b.W : b.H;
        var m = Math.Max(0, Math.Min(Math.Max(0, o.MarginMm) * MmToPt, Math.Min(pw, ph) / 2 - 1));
        var aw = pw - m * 2; var ah = ph - m * 2;

        double sx, sy;
        switch (o.Fit)
        {
            case PageFitMode.Stretch: sx = aw / cw; sy = ah / ch; break;
            case PageFitMode.Cover: sx = sy = Math.Max(aw / cw, ah / ch); break;
            case PageFitMode.ActualSize: sx = sy = 1; break;
            case PageFitMode.ShrinkOnly: sx = sy = Math.Min(1.0, Math.Min(aw / cw, ah / ch)); break;
            default: sx = sy = Math.Min(aw / cw, ah / ch); break;
        }
        var dw = cw * sx; var dh = ch * sy;
        return new PagePlacement(pw, ph, m + (aw - dw) / 2, m + (ah - dh) / 2, dw, dh, m, m, aw, ah, sx, sy);
    }

    /// <summary>"A4", "Letter" … or "100 × 150 mm" for a page of the given size.</summary>
    public static string Describe(double wPt, double hPt)
    {
        var w = wPt / MmToPt; var h = hPt / MmToPt;
        var lo = Math.Min(w, h); var hi = Math.Max(w, h);
        foreach (var n in Named)
            if (Math.Abs(lo - n.W) <= 1.5 && Math.Abs(hi - n.H) <= 1.5) return n.Name;
        return $"{lo:0} × {hi:0} mm";
    }

    /// <summary>e.g. "8 × A4,  2 × Letter,  1 × 100 × 150 mm".</summary>
    public static string SummariseSizes(IEnumerable<PageItem> pages)
    {
        var groups = pages
            .GroupBy(p => { var (w, h) = p.DisplaySizePt(true); return Describe(w, h); })
            .OrderByDescending(g => g.Count()).ToList();
        var text = string.Join(",  ", groups.Take(5).Select(g => $"{g.Count()} × {g.Key}"));
        return groups.Count > 5 ? text + $"  and {groups.Count - 5} more size(s)" : text;
    }

    public static string Name(PageLayoutOptions o) => o.Size switch
    {
        TargetPageSize.Original => "original sizes",
        TargetPageSize.SameAsFirst => "size of the first page",
        TargetPageSize.Largest => "size of the largest page",
        TargetPageSize.Custom => $"{o.CustomWidthMm:0.#} × {o.CustomHeightMm:0.#} mm",
        _ => o.Size.ToString()
    };
}
