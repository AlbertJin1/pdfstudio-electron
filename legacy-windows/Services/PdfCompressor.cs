using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO.Compression;
using System.Text;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;
using PdfSharp.Pdf.IO;
using PdfStudio.Models;

namespace PdfStudio.Services;

/// <summary>What the compressor achieved. <see cref="Target"/> is 0 for the fixed presets.</summary>
public sealed record CompressionReport(long Before, long After, long Target, bool Reached, string Summary);

/// <summary>
/// Built-in PDF compression. Needs nothing installed. Three ways to ask for it:
///   • a preset (Light / Balanced / Strong),
///   • "reduce by N %" (the target is N % smaller than the file before compression),
///   • "reduce to X MB" (an exact size cap).
/// For the last two the compressor searches a ladder of 32 steps from gentle (JPEG quality 92, big pictures) to harsh
/// (quality 10, small pictures). It measures what every step would produce, picks the gentlest step that meets the
/// target, writes the file and checks the real size, stepping further down if it is still over. Text and vector art
/// are never rasterised, so only pictures lose quality. If even the harshest step cannot reach the target (a PDF that is
/// mostly text and fonts) the best result is kept and the report says so.
/// </summary>
public static class PdfCompressor
{
    private readonly record struct Rung(int Quality, int MaxDim);

    private sealed class Rendered { public byte[]? Jpg; public int W, H; }

    private sealed class Pic
    {
        public PdfDictionary Dict = null!;
        public byte[] Data = null!;
        public bool IsJpeg;
        public int W, H, Comps, Predictor;
        public long OrigLen => Data.Length;
    }

    private const int RungCount = 32;
    private static readonly Rung[] Ladder = BuildLadder();

    private static Rung[] BuildLadder()
    {
        var l = new Rung[RungCount];
        for (var i = 0; i < RungCount; i++)
        {
            var t = i / (double)(RungCount - 1);
            l[i] = new Rung((int)Math.Round(92 - t * 82), (int)Math.Round(3600 * Math.Pow(0.10, t)));   // q92/3600px → q10/360px
        }
        return l;
    }

    private static (Rung Rung, long MinBytes) PresetFor(PdfCompression level) => level switch
    {
        PdfCompression.Light => (new Rung(85, 3500), 8_000),     // ~300 dpi on A4
        PdfCompression.Strong => (new Rung(45, 1240), 2_000),    // ~100 dpi on A4
        PdfCompression.Balanced => (new Rung(70, 1800), 4_000),  // ~150 dpi on A4
        _ => (new Rung(90, int.MaxValue), 8_000)                  // None: grayscale only
    };

    private static int Dop => Math.Clamp(Environment.ProcessorCount - 1, 1, 8);

    public static CompressionReport Compress(string path, ExportOptions o) =>
        Compress(path, o.CompressionKind, o.Compression, o.ReducePercent, o.TargetSizeMb, o.Grayscale);

    /// <summary>Compresses the PDF in place. The file is only replaced when the result is smaller (or when grayscale was requested).</summary>
    public static CompressionReport Compress(string path, CompressionTargetKind kind, PdfCompression level, int reducePercent, double targetMb, bool grayscale)
    {
        var before = new FileInfo(path).Length;
        var targeted = kind != CompressionTargetKind.Preset;
        if (!targeted && level == PdfCompression.None && !grayscale) return new(before, before, 0, true, "");

        long target = 0;
        if (kind == CompressionTargetKind.ReducePercent) target = (long)(before * (1.0 - Math.Clamp(reducePercent, 1, 99) / 100.0));
        else if (kind == CompressionTargetKind.TargetSize) target = (long)(Math.Max(0.01, targetMb) * 1024 * 1024);
        if (targeted && target >= before && !grayscale)
            return new(before, before, target, true, $"The file ({Fmt(before)}) is already within the target ({Fmt(target)}), so it was left as it is.");

        var dir = Path.GetDirectoryName(Path.GetFullPath(path))!;
        var id = Guid.NewGuid().ToString("N");
        var s0 = Path.Combine(dir, $"~cmp_{id}_a.pdf");
        var s1 = Path.Combine(dir, $"~cmp_{id}_b.pdf");
        try
        {
            Stage0(path, s0, grayscale);
            var s0Size = new FileInfo(s0).Length;
            string produced = s0; long producedSize = s0Size;

            if (!targeted)
            {
                if (level != PdfCompression.None || grayscale)
                {
                    var (rung, minBytes) = PresetFor(level);
                    var size = WriteWithRung(s0, s1, rung, grayscale, minBytes);
                    if (size > 0) { produced = s1; producedSize = size; }
                }
            }
            else
            {
                const long minBytes = 2_000;
                var goal = (long)(target * 0.995);
                int chosen;
                if (!grayscale && s0Size <= goal) chosen = -1;                      // lossless tidy-up was already enough
                else chosen = ChooseRung(s0, goal, grayscale, minBytes, s0Size);
                if (chosen >= 0)
                {
                    var rung = chosen;
                    for (var attempt = 0; attempt < 5; attempt++)
                    {
                        var size = WriteWithRung(s0, s1, Ladder[rung], grayscale, minBytes);
                        if (size <= 0) break;
                        produced = s1; producedSize = size;
                        if (size <= target || rung >= RungCount - 1) break;
                        rung = Math.Min(RungCount - 1, rung + attempt + 1);          // estimate was a little optimistic: go harsher
                    }
                }
            }

            var replace = producedSize > 0 && (grayscale || producedSize < before);
            if (replace) File.Copy(produced, path, true);
            var after = replace ? producedSize : before;
            return Report(before, after, target, kind, level);
        }
        catch { return new(before, before, target, false, "Compression failed, so the file was left as it is."); }
        finally
        {
            foreach (var f in new[] { s0, s1 }) try { if (File.Exists(f)) File.Delete(f); } catch { }
        }
    }

    private static CompressionReport Report(long before, long after, long target, CompressionTargetKind kind, PdfCompression level)
    {
        var pct = before > 0 ? 100.0 * (before - after) / before : 0;
        var change = after < before ? $"{Fmt(before)} → {Fmt(after)} ({pct:0}% smaller)" : $"stayed at {Fmt(before)} (nothing more could be saved)";
        if (kind == CompressionTargetKind.Preset) return new(before, after, 0, true, "Compression: " + change + ".");
        if (after <= target) return new(before, after, target, true, "Compression: " + change + ".");
        return new(before, after, target, false,
            $"The target of {Fmt(target)} could not be reached: the file went {change}. The rest is text, fonts and drawings, which compression cannot shrink without losing content. Try a larger target.");
    }

    private static string Fmt(long b) => b >= 1024 * 1024 ? (b / 1048576.0).ToString("0.##", CultureInfo.InvariantCulture) + " MB" : Math.Max(1, b / 1024) + " KB";

    // ───────────────────────── stages ─────────────────────────

    /// <summary>Lossless step: grayscale for page content (when asked), then Flate-compress every stream still stored raw (pictures included).</summary>
    private static void Stage0(string src, string dst, bool grayscale)
    {
        using var doc = PdfReader.Open(src, PdfDocumentOpenMode.Modify);
        if (grayscale)
        {
            foreach (var page in doc.Pages) GrayStreamsOf(page);
            foreach (var obj in doc.Internals.GetAllObjects())
                if (obj is PdfDictionary d && d.Stream is not null && Name(d, "/Subtype") == "/Form") GrayStream(d);
        }
        foreach (var obj in doc.Internals.GetAllObjects())
        {
            if (obj is not PdfDictionary d || d.Stream?.Value is not { Length: > 64 }) continue;
            if (d.Elements.ContainsKey("/Filter") || Name(d, "/Type") == "/XRef") continue;
            try { d.Stream.Zip(); } catch { }
        }
        doc.Save(dst);
    }

    /// <summary>Finds the gentlest ladder step whose estimated file size is within <paramref name="goal"/> (binary search). Returns the harshest step if none is.</summary>
    private static int ChooseRung(string s0, long goal, bool gray, long minBytes, long s0Size)
    {
        using var doc = PdfReader.Open(s0, PdfDocumentOpenMode.Modify);
        var pics = Collect(doc, gray, minBytes);
        if (pics.Count == 0) return RungCount - 1;
        long orig = 0; foreach (var p in pics) orig += p.OrigLen;
        int lo = 0, hi = RungCount - 1, best = RungCount - 1;
        while (lo <= hi)
        {
            var mid = (lo + hi) / 2;
            var est = s0Size - orig + EstimatePictures(pics, Ladder[mid], gray);
            if (est <= goal) { best = mid; hi = mid - 1; } else lo = mid + 1;
        }
        return best;
    }

    /// <summary>Opens the lossless file fresh, re-encodes its pictures at the given step, saves, and returns the new size (0 on failure).</summary>
    private static long WriteWithRung(string s0, string dst, Rung rung, bool gray, long minBytes)
    {
        using (var doc = PdfReader.Open(s0, PdfDocumentOpenMode.Modify))
        {
            var pics = Collect(doc, gray, minBytes);
            ApplyPictures(pics, rung, gray);
            doc.Save(dst);
        }
        return File.Exists(dst) ? new FileInfo(dst).Length : 0;
    }

    // ───────────────────────── pictures ─────────────────────────

    private static List<Pic> Collect(PdfDocument doc, bool gray, long minBytes)
    {
        var list = new List<Pic>();
        foreach (var obj in doc.Internals.GetAllObjects())
        {
            if (obj is not PdfDictionary d || d.Stream is null) continue;
            try
            {
                if (Name(d, "/Subtype") != "/Image") continue;
                var p = MakePic(d, gray, minBytes);
                if (p is not null) list.Add(p);
            }
            catch { /* leave this picture untouched */ }
        }
        return list;
    }

    private static Pic? MakePic(PdfDictionary d, bool gray, long minBytes)
    {
        if (Bool(d, "/ImageMask") || d.Elements.ContainsKey("/Mask") || d.Elements.ContainsKey("/Decode") || d.Elements.ContainsKey("/SMaskInData")) return null;
        var filter = FilterOf(d);
        if (filter != "/DCTDecode" && filter != "/FlateDecode") return null;
        var w = d.Elements.GetInteger("/Width"); var h = d.Elements.GetInteger("/Height");
        if (w < 8 || h < 8 || (long)w * h > 150_000_000L) return null;
        var comps = Components(d);
        if (comps == 0) return null;
        var data = d.Stream!.Value;
        if (data is null || data.Length == 0) return null;
        if (!gray && data.Length < minBytes) return null;

        var pic = new Pic { Dict = d, Data = data, IsJpeg = filter == "/DCTDecode", W = w, H = h, Comps = comps };
        if (!pic.IsJpeg)
        {
            if (d.Elements.GetInteger("/BitsPerComponent") != 8) return null;
            var pd = Parms(d);
            if (pd is not null)
            {
                pic.Predictor = pd.Elements.GetInteger("/Predictor");
                if (pic.Predictor > 1)
                {
                    var colors = pd.Elements.GetInteger("/Colors"); if (colors == 0) colors = 1;
                    var cols = pd.Elements.GetInteger("/Columns"); if (cols == 0) cols = 1;
                    var bpc = pd.Elements.GetInteger("/BitsPerComponent"); if (bpc == 0) bpc = 8;
                    if (colors != comps || cols != w || bpc != 8) return null;
                }
            }
        }
        return pic;
    }

    private static long EstimatePictures(List<Pic> pics, Rung rung, bool gray)
    {
        var sizes = new long[pics.Count];
        Parallel.For(0, pics.Count, new ParallelOptions { MaxDegreeOfParallelism = Dop }, i =>
        {
            var p = pics[i];
            try
            {
                var r = Render(p, rung, gray);
                sizes[i] = r.Jpg is null ? p.OrigLen : gray ? r.Jpg.Length : Math.Min(p.OrigLen, r.Jpg.Length);
            }
            catch { sizes[i] = p.OrigLen; }
        });
        long total = 0; foreach (var s in sizes) total += s;
        return total;
    }

    private static void ApplyPictures(List<Pic> pics, Rung rung, bool gray)
    {
        var results = new Rendered?[pics.Count];
        Parallel.For(0, pics.Count, new ParallelOptions { MaxDegreeOfParallelism = Dop }, i =>
        {
            try { results[i] = Render(pics[i], rung, gray); } catch { results[i] = null; }
        });
        for (var i = 0; i < pics.Count; i++)
        {
            var r = results[i]; var p = pics[i];
            if (r?.Jpg is null) continue;
            if (!gray && r.Jpg.Length >= p.OrigLen) continue;      // never make a picture bigger
            var d = p.Dict;
            d.Stream!.Value = r.Jpg;
            d.Elements.SetName("/Filter", "/DCTDecode");
            d.Elements.Remove("/DecodeParms");
            d.Elements.Remove("/DP");
            d.Elements.SetInteger("/Width", r.W); d.Elements.SetInteger("/Height", r.H);
            d.Elements.SetName("/ColorSpace", "/DeviceRGB");
            d.Elements.SetInteger("/BitsPerComponent", 8);
        }
    }

    /// <summary>Decodes, scales down (never up) and JPEG-encodes one picture. Pure function: safe to run on several threads.</summary>
    private static Rendered Render(Pic p, Rung rung, bool gray)
    {
        using Bitmap src = p.IsJpeg ? DecodeJpeg(p.Data) : DecodeRaw(p);
        var scale = Math.Min(1.0, (double)rung.MaxDim / Math.Max(src.Width, src.Height));
        var nw = Math.Max(1, (int)Math.Round(src.Width * scale)); var nh = Math.Max(1, (int)Math.Round(src.Height * scale));
        using var dst = new Bitmap(nw, nh, PixelFormat.Format24bppRgb);
        dst.SetResolution(96, 96);
        using (var g = Graphics.FromImage(dst))
        using (var ia = new ImageAttributes())
        {
            g.Clear(Color.White);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.CompositingQuality = CompositingQuality.HighQuality;
            ia.SetWrapMode(WrapMode.TileFlipXY);
            if (gray)
            {
                var m = new ColorMatrix(new[]
                {
                    new[] { .299f, .299f, .299f, 0, 0 }, new[] { .587f, .587f, .587f, 0, 0 }, new[] { .114f, .114f, .114f, 0, 0 },
                    new[] { 0f, 0, 0, 1, 0 }, new[] { 0f, 0, 0, 0, 1 }
                });
                ia.SetColorMatrix(m);
            }
            g.DrawImage(src, new Rectangle(0, 0, nw, nh), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, ia);
        }
        return new Rendered { Jpg = EncodeJpeg(dst, rung.Quality), W = nw, H = nh };
    }

    private static Bitmap DecodeJpeg(byte[] data)
    {
        using var ms = new MemoryStream(data);
        using var img = Image.FromStream(ms, false, false);
        var bmp = new Bitmap(img.Width, img.Height, PixelFormat.Format24bppRgb);
        bmp.SetResolution(96, 96);
        using var g = Graphics.FromImage(bmp);
        g.Clear(Color.White);
        g.DrawImage(img, new Rectangle(0, 0, bmp.Width, bmp.Height), 0, 0, img.Width, img.Height, GraphicsUnit.Pixel);
        return bmp;
    }

    /// <summary>Flate picture: inflate, undo the PNG/TIFF predictor if there is one, build a 24-bit bitmap.</summary>
    private static Bitmap DecodeRaw(Pic p)
    {
        int w = p.W, h = p.H, comps = p.Comps;
        var raw = Inflate(p.Data);
        if (p.Predictor > 1) raw = Unpredict(raw, p.Predictor, comps, w, h);
        if (raw.Length < (long)w * h * comps) throw new InvalidDataException();
        var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        var bd = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        try
        {
            var row = new byte[Math.Abs(bd.Stride)];
            for (var y = 0; y < h; y++)
            {
                var si = y * w * comps;
                for (var x = 0; x < w; x++)
                {
                    if (comps == 3) { row[x * 3] = raw[si + x * 3 + 2]; row[x * 3 + 1] = raw[si + x * 3 + 1]; row[x * 3 + 2] = raw[si + x * 3]; }
                    else { var v = raw[si + x]; row[x * 3] = row[x * 3 + 1] = row[x * 3 + 2] = v; }
                }
                System.Runtime.InteropServices.Marshal.Copy(row, 0, bd.Scan0 + y * bd.Stride, w * 3);
            }
        }
        finally { bmp.UnlockBits(bd); }
        return bmp;
    }

    private static byte[] Inflate(byte[] data)
    {
        using var input = new MemoryStream(data);
        using var z = new ZLibStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        try { z.CopyTo(output); }
        catch (InvalidDataException) { if (output.Length == 0) throw; }   // truncated tail: keep what decoded
        return output.ToArray();
    }

    private static byte[] Unpredict(byte[] s, int predictor, int colors, int columns, int height)
    {
        var bpp = Math.Max(1, colors);                  // 8 bits per component, so bytes per pixel == colours
        var rowLen = colors * columns;
        if (predictor == 2)                             // TIFF: each byte is stored as the difference from the pixel to its left
        {
            for (var y = 0; y < height; y++)
            {
                var o = y * rowLen;
                if (o + rowLen > s.Length) break;
                for (var i = bpp; i < rowLen; i++) s[o + i] = (byte)(s[o + i] + s[o + i - bpp]);
            }
            return s;
        }
        var stride = rowLen + 1;                        // PNG: one filter-type byte in front of every row
        var res = new byte[(long)rowLen * height];
        for (var y = 0; y < height; y++)
        {
            var si = y * stride;
            if (si + stride > s.Length) throw new InvalidDataException();
            int ft = s[si], src = si + 1, dst = y * rowLen, prev = dst - rowLen;
            for (var i = 0; i < rowLen; i++)
            {
                int x = s[src + i];
                int a = i >= bpp ? res[dst + i - bpp] : 0;
                int b = y > 0 ? res[prev + i] : 0;
                int c = y > 0 && i >= bpp ? res[prev + i - bpp] : 0;
                switch (ft)
                {
                    case 0: break;
                    case 1: x += a; break;
                    case 2: x += b; break;
                    case 3: x += (a + b) / 2; break;
                    case 4: x += Paeth(a, b, c); break;
                    default: throw new InvalidDataException();
                }
                res[dst + i] = (byte)x;
            }
        }
        return res;
    }

    private static int Paeth(int a, int b, int c)
    {
        var p = a + b - c; var pa = Math.Abs(p - a); var pb = Math.Abs(p - b); var pc = Math.Abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }

    private static byte[] EncodeJpeg(Bitmap bmp, int quality)
    {
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
        using var ep = new EncoderParameters(1);
        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        using var ms = new MemoryStream();
        bmp.Save(ms, codec, ep);
        return ms.ToArray();
    }

    private static PdfDictionary? Parms(PdfDictionary d)
    {
        var p = Resolve(d.Elements["/DecodeParms"]) ?? Resolve(d.Elements["/DP"]);
        if (p is PdfArray a) p = a.Elements.Count > 0 ? Resolve(a.Elements[0]) : null;
        return p as PdfDictionary;
    }

    // ───────────────────────── PDF object helpers ─────────────────────────

    private static PdfItem? Resolve(PdfItem? i) => i is PdfReference r ? r.Value : i;

    private static string Name(PdfDictionary d, string key) => Resolve(d.Elements[key]) is PdfName n ? n.Value : "";

    private static bool Bool(PdfDictionary d, string key) => Resolve(d.Elements[key]) is PdfBoolean b && b.Value;

    private static string FilterOf(PdfDictionary d)
    {
        var f = Resolve(d.Elements["/Filter"]);
        if (f is null) return "";
        if (f is PdfName n) return n.Value;
        if (f is PdfArray a && a.Elements.Count == 1 && Resolve(a.Elements[0]) is PdfName n0) return n0.Value;
        return "?";
    }

    /// <summary>1 (gray), 3 (RGB) or 0 when the colour space is not one we can safely rewrite.</summary>
    private static int Components(PdfDictionary d)
    {
        var cs = Resolve(d.Elements["/ColorSpace"]);
        if (cs is PdfName n) return n.Value == "/DeviceRGB" ? 3 : n.Value == "/DeviceGray" ? 1 : 0;
        if (cs is PdfArray a && a.Elements.Count >= 2 && Resolve(a.Elements[0]) is PdfName kind)
        {
            if (kind.Value == "/CalRGB") return 3;
            if (kind.Value == "/CalGray") return 1;
            if (kind.Value == "/ICCBased" && Resolve(a.Elements[1]) is PdfDictionary icc)
            {
                var c = icc.Elements.GetInteger("/N");
                return c == 3 ? 3 : c == 1 ? 1 : 0;
            }
        }
        return 0;
    }

    // ───────────────────────── grayscale for page content ─────────────────────────

    private static void GrayStreamsOf(PdfPage page)
    {
        try
        {
            var contents = page.Contents.Elements;
            for (var i = 0; i < contents.Count; i++)
                if (contents.GetDictionary(i) is { Stream: not null } cd) GrayStream(cd);
        }
        catch { }
    }

    private static void GrayStream(PdfDictionary d)
    {
        try
        {
            var s = d.Stream!;
            if (!s.TryUncompress() || s.Value is null) return;
            var converted = GrayContent(s.Value);
            if (converted is not null) s.Value = converted;
            s.Zip();
        }
        catch { }
    }

    private static bool IsWs(byte b) => b is 0 or 9 or 10 or 12 or 13 or 32;
    private static bool IsDelim(byte b) => b is (byte)'(' or (byte)')' or (byte)'<' or (byte)'>' or (byte)'[' or (byte)']' or (byte)'{' or (byte)'}' or (byte)'/' or (byte)'%';

    private static int IndexOfToken(byte[] s, int from, string tok)
    {
        for (var i = from; i + tok.Length <= s.Length; i++)
        {
            if (i > 0 && !IsWs(s[i - 1])) continue;
            var ok = true;
            for (var k = 0; k < tok.Length && ok; k++) ok = s[i + k] == tok[k];
            if (ok && (i + tok.Length == s.Length || IsWs(s[i + tok.Length]))) return i;
        }
        return -1;
    }

    /// <summary>Rewrites rg/RG/k/K colour operators as gray g/G. Everything else is copied through untouched.</summary>
    private static byte[]? GrayContent(byte[] s)
    {
        var o = new MemoryStream(s.Length);
        var nums = new List<(int Start, double Val)>();
        int i = 0, copied = 0, n = s.Length;
        var changed = false;
        var inv = CultureInfo.InvariantCulture;

        void Replace(int start, int end, double gray, bool stroke)
        {
            o.Write(s, copied, start - copied);
            o.Write(Encoding.ASCII.GetBytes(Math.Round(Math.Clamp(gray, 0, 1), 3).ToString("0.###", inv) + (stroke ? " G" : " g")));
            copied = end; changed = true;
        }

        while (i < n)
        {
            var c = s[i];
            if (IsWs(c)) { i++; continue; }
            if (c == '%') { while (i < n && s[i] != 10 && s[i] != 13) i++; continue; }
            if (c == '(')
            {
                var depth = 0;
                for (; i < n; i++)
                {
                    if (s[i] == '\\') { i++; continue; }
                    if (s[i] == '(') depth++;
                    else if (s[i] == ')' && --depth == 0) { i++; break; }
                }
                nums.Clear(); continue;
            }
            if (c == '<')
            {
                if (i + 1 < n && s[i + 1] == '<') i += 2; else { while (i < n && s[i] != '>') i++; i++; }
                nums.Clear(); continue;
            }
            if (c == '/') { i++; while (i < n && !IsWs(s[i]) && !IsDelim(s[i])) i++; nums.Clear(); continue; }
            if (IsDelim(c)) { i++; nums.Clear(); continue; }

            var st = i;
            while (i < n && !IsWs(s[i]) && !IsDelim(s[i])) i++;
            var tok = Encoding.ASCII.GetString(s, st, i - st);
            if (double.TryParse(tok, NumberStyles.Float, inv, out var v)) { nums.Add((st, v)); continue; }

            switch (tok)
            {
                case "BI":
                {
                    var id = IndexOfToken(s, i, "ID");
                    if (id < 0) return null;
                    var ei = IndexOfToken(s, id + 3, "EI");
                    if (ei < 0) return null;
                    i = ei + 2;
                    break;
                }
                case "rg" or "RG" when nums.Count >= 3:
                {
                    var a = nums[^3];
                    Replace(a.Start, i, 0.299 * a.Val + 0.587 * nums[^2].Val + 0.114 * nums[^1].Val, tok == "RG");
                    break;
                }
                case "k" or "K" when nums.Count >= 4:
                {
                    var a = nums[^4];
                    double cy = nums[^4].Val, m = nums[^3].Val, y = nums[^2].Val, k = nums[^1].Val;
                    Replace(a.Start, i, 1 - Math.Min(1, 0.30 * cy + 0.59 * m + 0.11 * y + k), tok == "K");
                    break;
                }
            }
            nums.Clear();
        }
        if (!changed) return null;
        o.Write(s, copied, n - copied);
        return o.ToArray();
    }
}
