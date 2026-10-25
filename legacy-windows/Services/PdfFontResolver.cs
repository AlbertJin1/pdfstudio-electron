using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace PdfStudio.Services;

/// <summary>
/// Everything the Word export needs to know about one font family used in a PDF.
/// <see cref="Family"/> is the REAL family name that is written into the .docx (so Word on the reader's PC uses the
/// genuine font when it has it); <see cref="AltName"/>/<see cref="Kind"/>/<see cref="Panose"/> go into the document's
/// font table so Word / LibreOffice pick a similar-looking font when it has not; <see cref="MeasureFamily"/> is the font
/// that is installed on THIS computer and is only used to measure text while converting.
/// </summary>
public sealed class PdfFontInfo
{
    public string Family { get; init; } = "Arial";
    public string MeasureFamily { get; init; } = "Arial";
    public string AltName { get; init; } = "Arial";
    /// <summary>Word font family class: swiss (sans), roman (serif), modern (monospace), script, decorative.</summary>
    public string Kind { get; init; } = "swiss";
    /// <summary>20 hex digits, or null when unknown.</summary>
    public string? Panose { get; init; }
    public bool IsFixedPitch => Kind == "modern";
}

/// <summary>A font family plus the bold/italic look of the face that was actually used.</summary>
public sealed record PdfFace(PdfFontInfo Font, bool Bold, bool Italic);

/// <summary>
/// Works out which font a piece of PDF text really uses. PDF producers often rename fonts to meaningless names
/// ("CIDFont+F1") and set misleading flags, so the name is read from the embedded font program itself (its 'name' and
/// 'OS/2' tables), then from PDFium, then from the PDF's own font name, then guessed from panose / flags.
/// </summary>
public sealed class PdfFontResolver
{
    private const string Lib = "pdfium";

    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr FPDFTextObj_GetFont(IntPtr textObject);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern int FPDFFont_GetFontData(IntPtr font, byte[]? buffer, UIntPtr bufLen, out UIntPtr outBufLen);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern UIntPtr FPDFFont_GetFamilyName(IntPtr font, byte[]? buffer, UIntPtr length);
    [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)] private static extern UIntPtr FPDFFont_GetBaseFontName(IntPtr font, byte[]? buffer, UIntPtr length);

    private readonly Dictionary<(IntPtr, string), PdfFace> byHandle = new();
    private readonly Dictionary<string, PdfFace> byName = new();
    private bool fontApiMissing, dataApiMissing, nameApiMissing;

    // ───────────────────────── public API ─────────────────────────

    /// <summary>The face of a PDFium text object. <paramref name="rawName"/>/<paramref name="flags"/> come from FPDFText_GetFontInfo.</summary>
    public PdfFace For(IntPtr textObject, string rawName, int flags, int weight)
    {
        IntPtr font = IntPtr.Zero;
        if (textObject != IntPtr.Zero && !fontApiMissing)
        {
            try { font = FPDFTextObj_GetFont(textObject); }
            catch (EntryPointNotFoundException) { fontApiMissing = true; }
            catch { }
        }
        // the handle alone could be reused for another font after pages are closed, so the PDF's own name/flags are part of the key
        var nameKey = rawName + "|" + flags + "|" + (weight >= 600 ? 1 : 0);
        PdfFace? hit;
        if (font != IntPtr.Zero)
        {
            if (byHandle.TryGetValue((font, nameKey), out hit)) return hit;
        }
        else if (byName.TryGetValue(nameKey, out hit)) return hit;

        Embedded? emb = font != IntPtr.Zero ? ReadFont(font) : null;
        var face = Build(rawName, flags, weight, emb);
        if (font != IntPtr.Zero) byHandle[(font, nameKey)] = face; else byName[nameKey] = face;
        return face;
    }

    /// <summary>Installed font that looks like <paramref name="pdfName"/> (used by the editor, which has no font handle).</summary>
    public static string MapToInstalled(string pdfName, int flags)
    {
        var fam = CleanFamily(pdfName, true);
        return Describe(IsGeneric(fam) ? null : fam, flags, null).MeasureFamily;
    }

    // ───────────────────────── building ─────────────────────────

    private static PdfFace Build(string rawName, int flags, int weight, Embedded? e)
    {
        // candidate names, best first: the embedded font's own names, PDFium's view, the PDF's name
        var cands = new List<(string Name, bool Ps)>();
        if (e != null)
        {
            if (!string.IsNullOrWhiteSpace(e.Typographic)) cands.Add((e.Typographic!, false));
            if (!string.IsNullOrWhiteSpace(e.Family)) cands.Add((e.Family!, false));
            if (!string.IsNullOrWhiteSpace(e.Ps)) cands.Add((e.Ps!, true));
            if (!string.IsNullOrWhiteSpace(e.PdfiumFamily)) cands.Add((e.PdfiumFamily!, false));
            if (!string.IsNullOrWhiteSpace(e.PdfiumBase)) cands.Add((e.PdfiumBase!, true));
        }
        cands.Add((rawName, true));

        string? family = null;
        foreach (var (name, ps) in cands)
        {
            var c = CleanFamily(name, ps);
            if (c.Length >= 2 && !IsGeneric(c)) { family = c; break; }
        }

        var allNames = string.Join(" ", cands.Select(c => c.Name)).ToLowerInvariant();
        var nameBold = allNames.Contains("bold") || allNames.Contains("black") || allNames.Contains("heavy");
        var nameItalic = allNames.Contains("italic") || allNames.Contains("oblique");
        bool bold, italic;
        if (e is { HasStyle: true })
        {
            // the embedded font program knows which face it is; PDFium's weight/flags are unreliable
            // (e.g. weights like 4200 for regular text) and must not override it
            bold = e.Bold || nameBold;
            italic = e.Italic || nameItalic;
        }
        else
        {
            // PDFium weights are only meaningful in the normal 100..900 range
            bold = (weight >= 600 && weight <= 900) || (flags & 0x40000) != 0 || nameBold;
            italic = (flags & 0x40) != 0 || nameItalic;
        }

        // a style word that is part of the family ("Arial Black") must not be treated as a style of its own
        var info = Describe(family, flags, e?.Panose, e?.IsFixed ?? false);
        return new PdfFace(info, bold, italic);
    }

    // ───────────────────────── names ─────────────────────────

    private static string Key(string s) => new string(s.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

    private static readonly Regex GenericRx = new(
        @"^((cidfont)?(f|g|r|c|t|tt|p|x|font|fnt|type|ttf|otf|im)\d+|(cidfont|truetype|identity|unnamed|noname|untitled|default|font)\d*)$",
        RegexOptions.Compiled);

    private static bool IsGeneric(string s)
    {
        var k = Key(s);
        return k.Length < 2 || GenericRx.IsMatch(k);
    }

    /// <summary>"ABCDEF+Arial-BoldMT" → "Arial"; "TimesNewRomanPSMT" → "TimesNewRoman".</summary>
    private static string CleanFamily(string s, bool postScript)
    {
        s = (s ?? "").Replace("\0", "").Trim();
        s = Regex.Replace(s, "^[A-Z]{6}\\+", "");
        s = Regex.Replace(s, "^CIDFont\\+?", "", RegexOptions.IgnoreCase);
        if (postScript)
        {
            var i = s.IndexOfAny(new[] { '-', ',' });
            if (i > 0) s = s[..i];
        }
        if (!s.Contains(' '))
        {
            if (s.Length > 4) s = Regex.Replace(s, "(PSMT|MT|PS)$", "");
            s = Regex.Replace(s, "(?<=[a-z])(BoldItalic|BoldOblique|Bold|Italic|Oblique|Regular)$", "");
        }
        return s.Trim();
    }

    private static string Prettify(string s) => s.Contains(' ') ? s : Regex.Replace(s, "(?<=[a-z])(?=[A-Z])", " ");

    // ───────────────────────── installed fonts ─────────────────────────

    private static HashSet<string>? installed;
    private static Dictionary<string, string>? installedByKey;
    private static readonly object InstalledGate = new();

    private static void LoadInstalled()
    {
        if (installed != null) return;
        lock (InstalledGate)
        {
            if (installed != null) return;
            var names = new List<string>();
            try { names = new InstalledFontCollection().Families.Select(f => f.Name).ToList(); } catch { }
            var byKey = new Dictionary<string, string>();
            foreach (var n in names) byKey[Key(n)] = n;
            installedByKey = byKey;
            installed = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>The installed font whose name matches, tolerant of spaces / case / PDF suffixes; null if there is none.</summary>
    private static string? FindInstalled(string name)
    {
        LoadInstalled();
        if (string.IsNullOrWhiteSpace(name)) return null;
        if (installed!.Contains(name)) return installed.TryGetValue(name, out var exact) ? exact : name;
        return installedByKey!.TryGetValue(Key(name), out var real) ? real : null;
    }

    // ───────────────────────── knowledge: look-alikes ─────────────────────────

    /// <summary>Groups of fonts with (nearly) identical glyph widths. The first name is the Office font; the second is the open-source twin Word/LibreOffice on other systems substitute.</summary>
    private static readonly (string Kind, string[] Names)[] Groups =
    {
        ("swiss",  new[] { "Arial", "Liberation Sans", "Arimo", "Helvetica", "Nimbus Sans", "Nimbus Sans L" }),
        ("roman",  new[] { "Times New Roman", "Liberation Serif", "Tinos", "Times", "Nimbus Roman", "Nimbus Roman No9 L" }),
        ("modern", new[] { "Courier New", "Liberation Mono", "Cousine", "Courier", "Nimbus Mono", "Nimbus Mono L" }),
        ("swiss",  new[] { "Calibri", "Carlito" }),
        ("roman",  new[] { "Cambria", "Caladea" }),
        ("swiss",  new[] { "Arial Narrow", "Liberation Sans Narrow" }),
        ("roman",  new[] { "Georgia", "Gelasio" }),
        ("swiss",  new[] { "Verdana", "DejaVu Sans" }),
        ("modern", new[] { "Consolas", "Inconsolata" }),
    };

    private static readonly Dictionary<string, string> Aliases = new()
    {
        ["helvetica"] = "Arial", ["helveticaneue"] = "Arial", ["arialmt"] = "Arial", ["liberationsans"] = "Arial", ["arimo"] = "Arial",
        ["times"] = "Times New Roman", ["timesroman"] = "Times New Roman", ["timesnewromanps"] = "Times New Roman", ["liberationserif"] = "Times New Roman", ["tinos"] = "Times New Roman",
        ["courier"] = "Courier New", ["couriernewps"] = "Courier New", ["liberationmono"] = "Courier New", ["cousine"] = "Courier New",
        ["carlito"] = "Calibri", ["caladea"] = "Cambria",
    };

    private static readonly Dictionary<string, string[]> KindFallbacks = new()
    {
        ["swiss"] = new[] { "Arial", "Liberation Sans", "Arimo", "Segoe UI", "Calibri", "Verdana", "Tahoma", "Helvetica", "DejaVu Sans" },
        ["roman"] = new[] { "Times New Roman", "Liberation Serif", "Tinos", "Georgia", "Cambria", "Palatino Linotype", "Book Antiqua", "DejaVu Serif" },
        ["modern"] = new[] { "Courier New", "Liberation Mono", "Cousine", "Consolas", "Lucida Console", "DejaVu Sans Mono" },
        ["script"] = new[] { "Segoe Script", "Brush Script MT", "Lucida Handwriting", "Comic Sans MS", "Arial", "Liberation Sans" },
        ["decorative"] = new[] { "Arial", "Liberation Sans", "Arimo", "Segoe UI" },
    };

    private static readonly Dictionary<string, string> KindAlt = new()
    {
        ["swiss"] = "Arial", ["roman"] = "Times New Roman", ["modern"] = "Courier New", ["script"] = "Segoe Script", ["decorative"] = "Arial",
    };

    private static string GuessKind(string family, int flags, byte[]? panose, bool fixedPitch)
    {
        var k = Key(family);
        foreach (var (kind, names) in Groups)
            if (names.Any(n => Key(n) == k)) return kind;

        string[] mono = { "mono", "courier", "consol", "typewriter", "lucidaconsole", "andale", "terminal", "fixed", "menlo", "monaco", "code" };
        string[] script = { "script", "handwrit", "brush", "calligra", "chancery", "cursive", "lucidahand", "zapfchancery", "segoeprint" };
        string[] serif = { "times", "georgia", "garamond", "palatino", "cambria", "bookman", "centuryschool", "minion", "baskerville", "didot", "bodoni", "roman", "bookantiqua", "constantia", "caslon", "sabon", "serif", "mincho", "song", "merriweather", "playfair", "lora" };
        string[] sans = { "sans", "arial", "helvet", "verdana", "tahoma", "calibri", "segoe", "trebuchet", "gothic", "franklin", "myriad", "frutiger", "futura", "gill", "lato", "roboto", "opensans", "noto", "candara", "corbel", "univers", "avenir", "montserrat", "poppins", "ubuntu", "impact" };

        if (panose is { Length: 10 } && panose[0] != 0)
        {
            if (panose[0] == 3) return "script";
            if (panose[0] == 4) return "decorative";
            if (panose[0] == 2)
            {
                if (panose[3] == 9) return "modern";                      // monospaced proportion
                if (panose[1] >= 2 && panose[1] <= 10) return "roman";    // cove / square cove / bone / ... serif styles
                if (panose[1] >= 11 && panose[1] <= 15) return "swiss";   // normal / obtuse / perpendicular sans, flared, rounded
            }
        }
        if (fixedPitch) return "modern";
        if (mono.Any(k.Contains)) return "modern";
        if (script.Any(k.Contains)) return "script";
        if (sans.Any(k.Contains) && !(k.Contains("serif") && !k.Contains("sans"))) return "swiss";
        if (serif.Any(k.Contains)) return "roman";

        // PDF font flags are the least reliable hint (producers set them carelessly): fixed 1, serif 2, script 8
        if ((flags & 0x1) != 0) return "modern";
        if ((flags & 0x8) != 0) return "script";
        if ((flags & 0x2) != 0) return "roman";
        return "swiss";
    }

    private static readonly Dictionary<string, PdfFontInfo> Interned = new();

    /// <summary>Resolves a family name (or null when the PDF gave no usable name) to the font to write and the font to measure with.</summary>
    private static PdfFontInfo Describe(string? family, int flags, byte[]? panose, bool fixedPitch = false)
    {
        string? real = family != null ? FindInstalled(family) : null;
        var kind = GuessKind(family ?? "", flags, panose, fixedPitch);

        string desired;
        if (family == null) desired = KindAlt[kind];
        else if (real != null) desired = real;
        else if (Aliases.TryGetValue(Key(family), out var alias)) desired = alias;
        else desired = Prettify(family);

        var dk = Key(desired);
        var group = Groups.FirstOrDefault(g => g.Names.Any(n => Key(n) == dk));
        var twins = group.Names ?? Array.Empty<string>();

        // font used for measuring on this PC: the real one, else a metric twin, else the best installed look-alike
        var measure = FindInstalled(desired);
        if (measure == null) foreach (var t in twins) { measure = FindInstalled(t); if (measure != null) break; }
        if (measure == null) foreach (var t in KindFallbacks[kind]) { measure = FindInstalled(t); if (measure != null) break; }
        measure ??= "Arial";

        // alternate name stored in the document: the metric twin if there is one, else the usual Office font of that kind
        string alt = KindAlt[kind];
        if (twins.Length > 1) alt = Key(twins[0]) == dk ? twins[1] : twins[0];
        else if (Key(alt) == dk) alt = KindFallbacks[kind].FirstOrDefault(n => Key(n) != dk) ?? "Arial";

        string? pan = null;
        if (panose is { Length: 10 } && panose[0] != 0)
        {
            var p = (byte[])panose.Clone();
            p[2] = 0;   // weight differs between Regular and Bold faces of one family: "any"
            pan = Convert.ToHexString(p);
        }

        lock (Interned)
        {
            if (Interned.TryGetValue(dk, out var have)) return have;
            return Interned[dk] = new PdfFontInfo { Family = desired, MeasureFamily = measure, AltName = alt, Kind = kind, Panose = pan };
        }
    }

    // ───────────────────────── reading the embedded font ─────────────────────────

    private sealed class Embedded
    {
        public string? Typographic, Family, Sub, Ps, PdfiumFamily, PdfiumBase;
        public bool Bold, Italic, IsFixed, HasStyle;
        public byte[]? Panose;
    }

    private Embedded ReadFont(IntPtr font)
    {
        var e = new Embedded();
        if (!dataApiMissing)
        {
            try
            {
                if (FPDFFont_GetFontData(font, null, UIntPtr.Zero, out var need) != 0)
                {
                    var size = need.ToUInt64();
                    if (size > 12 && size < 48_000_000)
                    {
                        var buf = new byte[(int)size];
                        if (FPDFFont_GetFontData(font, buf, (UIntPtr)size, out _) != 0) ParseSfnt(buf, e);
                    }
                }
            }
            catch (EntryPointNotFoundException) { dataApiMissing = true; }
            catch { }
        }
        if (!nameApiMissing)
        {
            try
            {
                e.PdfiumFamily = PdfiumString((b, n) => FPDFFont_GetFamilyName(font, b, n));
                e.PdfiumBase = PdfiumString((b, n) => FPDFFont_GetBaseFontName(font, b, n));
            }
            catch (EntryPointNotFoundException) { nameApiMissing = true; }
            catch { }
        }
        return e;
    }

    private static string? PdfiumString(Func<byte[]?, UIntPtr, UIntPtr> call)
    {
        var n = (int)Math.Min(call(null, UIntPtr.Zero).ToUInt64(), 1024UL);
        if (n <= 1) return null;
        var b = new byte[n];
        call(b, (UIntPtr)(ulong)n);
        return Encoding.UTF8.GetString(b, 0, n - 1).Trim('\0');
    }

    private static int U16(byte[] d, int o) => (d[o] << 8) | d[o + 1];
    private static uint U32(byte[] d, int o) => ((uint)d[o] << 24) | ((uint)d[o + 1] << 16) | ((uint)d[o + 2] << 8) | d[o + 3];

    /// <summary>Reads family / style names, weight, panose and pitch from a TrueType/OpenType font program.</summary>
    private static void ParseSfnt(byte[] d, Embedded e)
    {
        try
        {
            var baseOff = 0;
            var tag = U32(d, 0);
            if (tag == 0x74746366) baseOff = (int)U32(d, 12);                        // 'ttcf' collection: first font
            else if (tag != 0x00010000 && tag != 0x4F54544F && tag != 0x74727565) return; // not TrueType / 'OTTO' / 'true'

            var count = U16(d, baseOff + 4);
            var tables = new Dictionary<string, (int Off, int Len)>();
            for (var i = 0; i < count; i++)
            {
                var rec = baseOff + 12 + 16 * i;
                if (rec + 16 > d.Length) break;
                var name = Encoding.ASCII.GetString(d, rec, 4);
                long off = U32(d, rec + 8), len = U32(d, rec + 12);
                if (off >= 0 && off < d.Length) tables[name] = ((int)off, (int)Math.Min(len, d.Length - off));
            }

            var macBold = false; var macItalic = false;
            if (tables.TryGetValue("head", out var head) && head.Len >= 46)
            {
                var mac = U16(d, head.Off + 44);
                macBold = (mac & 1) != 0; macItalic = (mac & 2) != 0;
            }
            if (tables.TryGetValue("post", out var post) && post.Len >= 16) e.IsFixed = U32(d, post.Off + 12) != 0;

            var weight = 0; var selBold = false; var selItalic = false;
            if (tables.TryGetValue("OS/2", out var os2) && os2.Len >= 64)
            {
                weight = U16(d, os2.Off + 4);
                var sel = U16(d, os2.Off + 62);
                selItalic = (sel & 0x01) != 0; selBold = (sel & 0x20) != 0;
                var pan = new byte[10];
                Array.Copy(d, os2.Off + 32, pan, 0, 10);
                e.Panose = pan;
            }

            if (tables.TryGetValue("name", out var nt) && nt.Len >= 6)
            {
                var best = new Dictionary<int, (int Prio, string Text)>();
                var cnt = U16(d, nt.Off + 2); var strOff = nt.Off + U16(d, nt.Off + 4);
                for (var i = 0; i < cnt; i++)
                {
                    var r = nt.Off + 6 + 12 * i;
                    if (r + 12 > d.Length) break;
                    int plat = U16(d, r), lang = U16(d, r + 4), id = U16(d, r + 6), len = U16(d, r + 8), off = U16(d, r + 10);
                    if (id is not (1 or 2 or 6 or 16 or 17)) continue;
                    var so = strOff + off;
                    if (so < 0 || so + len > d.Length || len == 0) continue;
                    string text; int prio;
                    if (plat == 3 || plat == 0) { text = Encoding.BigEndianUnicode.GetString(d, so, len); prio = plat == 3 ? (lang == 0x409 ? 3 : 2) : 1; }
                    else if (plat == 1) { text = Encoding.Latin1.GetString(d, so, len); prio = 0; }
                    else continue;
                    text = text.Trim('\0', ' ');
                    if (text.Length == 0) continue;
                    if (!best.TryGetValue(id, out var cur) || prio > cur.Prio) best[id] = (prio, text);
                }
                if (best.TryGetValue(16, out var typo)) e.Typographic = typo.Text;
                if (best.TryGetValue(1, out var fam)) e.Family = fam.Text;
                if (best.TryGetValue(6, out var ps)) e.Ps = ps.Text;
                if (best.TryGetValue(17, out var sub) || best.TryGetValue(2, out sub)) e.Sub = sub.Text;
            }

            var subLower = (e.Sub ?? "").ToLowerInvariant();
            e.HasStyle = tables.ContainsKey("OS/2") || tables.ContainsKey("head");
            e.Bold = weight >= 600 || selBold || macBold || subLower.Contains("bold") || subLower.Contains("black") || subLower.Contains("heavy");
            e.Italic = selItalic || macItalic || subLower.Contains("italic") || subLower.Contains("oblique");
        }
        catch { /* damaged font program: fall back to the other name sources */ }
    }
}
