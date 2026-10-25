using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace PdfStudio.Services;

/// <summary>One signature kept in the user's library.</summary>
public sealed record SavedSignature(string Id, string Name, string Path, DateTime Created);

/// <summary>
/// The user's saved signatures. Every signature is normalised to a trimmed, 32-bit PNG with a real alpha channel and kept in
/// %LOCALAPPDATA%\PdfStudio\signatures, so it is available every time the app starts (no file browsing).
/// Also converts photos / scans on white paper into transparent signatures.
/// </summary>
public static class SignatureStore
{
    /// <summary>Widest stored signature in pixels (plenty for print quality at signature size).</summary>
    public const int MaxPixelWidth = 1200;
    /// <summary>Source pictures are scaled down to this longest side before processing (keeps the live preview quick).</summary>
    private const int WorkMax = 1600;
    private const int MaxNameLength = 40;
    private static readonly object gate = new();

    public static string Folder => System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PdfStudio", "signatures");

    private static string IndexPath => System.IO.Path.Combine(Folder, "index.tsv");
    private static string FileOf(string id) => System.IO.Path.Combine(Folder, id + ".png");

    // ───────────────────────── library ─────────────────────────

    /// <summary>All saved signatures, oldest first. Entries whose file is gone are dropped; stray PNGs are picked up.</summary>
    public static IReadOnlyList<SavedSignature> List()
    {
        lock (gate) return ReadIndex().OrderBy(s => s.Created).ToList();
    }

    public static bool Any() { lock (gate) return ReadIndex().Count > 0; }

    public static SavedSignature Add(Bitmap processed, string? name)
    {
        lock (gate)
        {
            Directory.CreateDirectory(Folder);
            var id = Guid.NewGuid().ToString("N");
            var file = FileOf(id);
            processed.Save(file, ImageFormat.Png);
            var list = ReadIndex();
            var sig = new SavedSignature(id, CleanName(name, list), file, DateTime.Now);
            list.Add(sig);
            WriteIndex(list);
            return sig;
        }
    }

    /// <summary>Stores an existing picture (for example the drawn signature PNG) after trimming its empty margins.</summary>
    public static SavedSignature AddFromFile(string path, string? name)
    {
        using var src = LoadSource(path);
        using var trimmed = Process(src, removeBackground: false, strength: 0)
            ?? throw new InvalidOperationException("The signature is empty.");
        return Add(trimmed, name);
    }

    public static SavedSignature? Rename(string id, string? name)
    {
        lock (gate)
        {
            var list = ReadIndex();
            var i = list.FindIndex(s => s.Id == id);
            if (i < 0) return null;
            var others = list.Where(s => s.Id != id).ToList();
            list[i] = list[i] with { Name = CleanName(name, others) };
            WriteIndex(list);
            return list[i];
        }
    }

    public static void Delete(string id)
    {
        lock (gate)
        {
            var list = ReadIndex();
            list.RemoveAll(s => s.Id == id);
            WriteIndex(list);
            try { File.Delete(FileOf(id)); } catch { }
        }
    }

    public static string NextName() { lock (gate) return NextName(ReadIndex()); }

    private static string NextName(List<SavedSignature> list)
    {
        for (var n = 1; ; n++)
        {
            var candidate = $"Signature {n}";
            if (!list.Any(s => string.Equals(s.Name, candidate, StringComparison.OrdinalIgnoreCase))) return candidate;
        }
    }

    private static string CleanName(string? name, List<SavedSignature> list)
    {
        var n = new string((name ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (n.Length > MaxNameLength) n = n[..MaxNameLength].TrimEnd();
        return n.Length == 0 ? NextName(list) : n;
    }

    private static List<SavedSignature> ReadIndex()
    {
        var list = new List<SavedSignature>();
        try
        {
            if (!Directory.Exists(Folder)) return list;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (File.Exists(IndexPath))
            {
                foreach (var line in File.ReadAllLines(IndexPath))
                {
                    var p = line.Split('\t');
                    if (p.Length < 2 || p[0].Length == 0 || !seen.Add(p[0])) continue;
                    var file = FileOf(p[0]);
                    if (!File.Exists(file)) continue;
                    var created = p.Length > 2 && long.TryParse(p[2], out var ticks) && ticks > 0 && ticks < DateTime.MaxValue.Ticks
                        ? new DateTime(ticks) : File.GetCreationTime(file);
                    list.Add(new SavedSignature(p[0], p[1], file, created));
                }
            }
            // self-heal: a PNG that is in the folder but missing from the index (index lost or damaged)
            foreach (var f in Directory.GetFiles(Folder, "*.png"))
            {
                var id = System.IO.Path.GetFileNameWithoutExtension(f);
                if (seen.Add(id)) list.Add(new SavedSignature(id, NextName(list), f, File.GetCreationTime(f)));
            }
        }
        catch { }
        return list;
    }

    private static void WriteIndex(List<SavedSignature> list)
    {
        try
        {
            Directory.CreateDirectory(Folder);
            var tmp = IndexPath + ".tmp";
            File.WriteAllLines(tmp, list.Select(s => $"{s.Id}\t{s.Name.Replace('\t', ' ')}\t{s.Created.Ticks}"));
            File.Move(tmp, IndexPath, true);
        }
        catch { }
    }

    // ───────────────────────── loading ─────────────────────────

    /// <summary>
    /// Reads a picture without keeping the file locked, applies the camera (EXIF) orientation and scales it down to a
    /// working size. Always returns a 32-bit ARGB bitmap. Throws if the file is not a readable picture.
    /// </summary>
    public static Bitmap LoadSource(string path)
    {
        var bytes = File.ReadAllBytes(path);
        using var ms = new MemoryStream(bytes);
        using var img = Image.FromStream(ms, false, false);
        ApplyExifOrientation(img);
        var scale = Math.Min(1.0, (double)WorkMax / Math.Max(img.Width, img.Height));
        var w = Math.Max(1, (int)Math.Round(img.Width * scale));
        var h = Math.Max(1, (int)Math.Round(img.Height * scale));
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.Clear(Color.Transparent);
        g.CompositingMode = CompositingMode.SourceCopy;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        using var ia = new ImageAttributes();
        ia.SetWrapMode(WrapMode.TileFlipXY);
        g.DrawImage(img, new Rectangle(0, 0, w, h), 0, 0, img.Width, img.Height, GraphicsUnit.Pixel, ia);
        return bmp;
    }

    private static void ApplyExifOrientation(Image img)
    {
        try
        {
            if (!img.PropertyIdList.Contains(0x0112)) return;
            var item = img.GetPropertyItem(0x0112);
            if (item?.Value is not { Length: >= 2 } v) return;
            var flip = BitConverter.ToUInt16(v, 0) switch
            {
                2 => RotateFlipType.RotateNoneFlipX,
                3 => RotateFlipType.Rotate180FlipNone,
                4 => RotateFlipType.RotateNoneFlipY,
                5 => RotateFlipType.Rotate90FlipX,
                6 => RotateFlipType.Rotate90FlipNone,
                7 => RotateFlipType.Rotate270FlipX,
                8 => RotateFlipType.Rotate270FlipNone,
                _ => RotateFlipType.RotateNoneFlipNone
            };
            if (flip != RotateFlipType.RotateNoneFlipNone) img.RotateFlip(flip);
        }
        catch { }
    }

    // ───────────────────────── processing ─────────────────────────

    /// <summary>True when the picture already has a meaningful transparent area (at least 1% of its pixels).</summary>
    public static bool HasTransparency(Bitmap bmp)
    {
        var (px, w, h, stride) = ReadPixels(bmp);
        long clear = 0;
        for (var y = 0; y < h; y++)
        {
            var row = y * stride;
            for (var x = 0; x < w; x++) if (px[row + x * 4 + 3] < 250) clear++;
        }
        return clear >= (long)w * h / 100;
    }

    /// <summary>
    /// Produces the signature to store: optionally removes a light paper background (soft edges, ink colour recovered),
    /// trims the empty margins and limits the size. <paramref name="strength"/> 0..100 = how much faint shading is also
    /// removed. Returns null when nothing visible is left. The caller owns the returned bitmap.
    /// </summary>
    public static Bitmap? Process(Bitmap src, bool removeBackground, int strength)
    {
        var (px, w, h, stride) = ReadPixels(src);
        if (removeBackground) RemovePaper(px, w, h, stride, Math.Clamp(strength, 0, 100));

        // bounding box of visible pixels
        int x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (var y = 0; y < h; y++)
        {
            var row = y * stride;
            for (var x = 0; x < w; x++)
            {
                if (px[row + x * 4 + 3] <= 12) continue;
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        if (x1 < 0) return null;
        const int margin = 3;
        x0 = Math.Max(0, x0 - margin); y0 = Math.Max(0, y0 - margin);
        x1 = Math.Min(w - 1, x1 + margin); y1 = Math.Min(h - 1, y1 + margin);
        var cw = x1 - x0 + 1; var ch = y1 - y0 + 1;

        var full = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        try
        {
            WritePixels(full, px, stride);
            using var cropped = full.Clone(new Rectangle(x0, y0, cw, ch), PixelFormat.Format32bppArgb);
            if (cw <= MaxPixelWidth) return new Bitmap(cropped);

            var nw = MaxPixelWidth; var nh = Math.Max(1, (int)Math.Round(ch * (double)nw / cw));
            var scaled = new Bitmap(nw, nh, PixelFormat.Format32bppArgb);
            using var g = Graphics.FromImage(scaled);
            g.Clear(Color.Transparent);
            g.CompositingMode = CompositingMode.SourceCopy;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            using var ia = new ImageAttributes();
            ia.SetWrapMode(WrapMode.TileFlipXY);
            g.DrawImage(cropped, new Rectangle(0, 0, nw, nh), 0, 0, cw, ch, GraphicsUnit.Pixel, ia);
            return scaled;
        }
        finally { full.Dispose(); }
    }

    /// <summary>
    /// Light paper -> transparent. The paper level is the 90th percentile of the brightness; the darker a pixel is than
    /// the paper the more opaque it becomes (smooth ramp), and its colour is un-mixed from the paper so the ink does not
    /// get a white halo when placed on a PDF page.
    /// </summary>
    private static void RemovePaper(byte[] px, int w, int h, int stride, int strength)
    {
        var hist = new int[256];
        long total = 0;
        for (var y = 0; y < h; y++)
        {
            var row = y * stride;
            for (var x = 0; x < w; x++)
            {
                var i = row + x * 4;
                if (px[i + 3] < 200) continue;
                hist[Luma(px, i)]++; total++;
            }
        }
        if (total == 0) return;

        long target = (long)(total * 0.90), acc = 0;
        var paper = 255;
        for (var l = 0; l < 256; l++) { acc += hist[l]; if (acc >= target) { paper = l; break; } }
        if (paper < 110) return;   // dark picture: not ink on paper, leave it alone

        double sr = 0, sg = 0, sb = 0; long n = 0;
        for (var y = 0; y < h; y++)
        {
            var row = y * stride;
            for (var x = 0; x < w; x++)
            {
                var i = row + x * 4;
                if (px[i + 3] < 200 || Luma(px, i) < paper - 12) continue;
                sb += px[i]; sg += px[i + 1]; sr += px[i + 2]; n++;
            }
        }
        double pr = n > 0 ? sr / n : 255, pg = n > 0 ? sg / n : 255, pb = n > 0 ? sb / n : 255;

        var cut0 = 10 + strength * 0.45;      // difference from paper below which a pixel is pure background
        var cut1 = cut0 + 55;                  // ...and above which it is fully ink
        for (var y = 0; y < h; y++)
        {
            var row = y * stride;
            for (var x = 0; x < w; x++)
            {
                var i = row + x * 4;
                var a0 = px[i + 3];
                if (a0 == 0) continue;
                var t = (paper - Luma(px, i) - cut0) / (cut1 - cut0);
                if (t <= 0) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }
                if (t > 1) t = 1;
                t = t * t * (3 - 2 * t);
                if (t < 0.004) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; continue; }
                px[i + 2] = Unmix(px[i + 2], pr, t);
                px[i + 1] = Unmix(px[i + 1], pg, t);
                px[i] = Unmix(px[i], pb, t);
                px[i + 3] = (byte)Math.Round(t * a0);
            }
        }
    }

    private static int Luma(byte[] px, int i) => (px[i + 2] * 77 + px[i + 1] * 150 + px[i] * 29) >> 8;

    private static byte Unmix(byte p, double paperChannel, double alpha)
    {
        var v = (p - paperChannel * (1 - alpha)) / alpha;
        return (byte)Math.Clamp((int)Math.Round(v), 0, 255);
    }

    private static (byte[] Px, int W, int H, int Stride) ReadPixels(Bitmap bmp)
    {
        var w = bmp.Width; var h = bmp.Height;
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var stride = w * 4;
            var px = new byte[stride * h];
            for (var y = 0; y < h; y++)
                System.Runtime.InteropServices.Marshal.Copy(data.Scan0 + y * data.Stride, px, y * stride, stride);
            return (px, w, h, stride);
        }
        finally { bmp.UnlockBits(data); }
    }

    private static void WritePixels(Bitmap bmp, byte[] px, int stride)
    {
        var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try
        {
            for (var y = 0; y < bmp.Height; y++)
                System.Runtime.InteropServices.Marshal.Copy(px, y * stride, data.Scan0 + y * data.Stride, stride);
        }
        finally { bmp.UnlockBits(data); }
    }

    // ───────────────────────── thumbnails ─────────────────────────

    /// <summary>A signature on a white card (readable in light and dark themes), fitted inside w x h.</summary>
    public static Bitmap Thumbnail(string path, int w, int h)
    {
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.Clear(Color.White);
        try
        {
            using var ms = new MemoryStream(File.ReadAllBytes(path));
            using var img = Image.FromStream(ms);
            const int pad = 6;
            var k = Math.Min((w - pad * 2) / (double)img.Width, (h - pad * 2) / (double)img.Height);
            var dw = Math.Max(1, (int)(img.Width * k)); var dh = Math.Max(1, (int)(img.Height * k));
            g.DrawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
        }
        catch { }
        using var pen = new Pen(Color.FromArgb(215, 219, 227));
        g.DrawRectangle(pen, 0, 0, w - 1, h - 1);
        return bmp;
    }
}
