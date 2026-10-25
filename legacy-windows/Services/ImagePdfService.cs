using PDFtoImage;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using SkiaSharp;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace PdfStudio.Services;

public enum ImageOutputFormat { Png, Jpeg, Webp, Bmp, Tiff, Gif }
public enum ImagePdfPageSize { FitToImage, A4, A3, A5, B5, Letter, Legal, Tabloid, Custom }
public enum ImagePdfOrientation { Auto, Portrait, Landscape }
public enum ImagePdfFit { Contain, Cover, Stretch, ActualSize }

public sealed class ImagePdfOptions
{
    public ImagePdfPageSize PageSize { get; set; } = ImagePdfPageSize.A4;
    public ImagePdfOrientation Orientation { get; set; } = ImagePdfOrientation.Auto;
    public ImagePdfFit Fit { get; set; } = ImagePdfFit.Contain;
    public double MarginMm { get; set; } = 10;
    public double CustomWidthMm { get; set; } = 210;
    public double CustomHeightMm { get; set; } = 297;
}

public sealed class PdfToImageOptions
{
    public ImageOutputFormat Format { get; set; } = ImageOutputFormat.Png;
    public int Dpi { get; set; } = 150;
    public int Quality { get; set; } = 90;
    public string Prefix { get; set; } = "page";
    /// <summary>Zero-based page indexes, or null for every page.</summary>
    public IReadOnlyList<int>? Pages { get; set; }
}

public readonly record struct PageImageLayout(double PageW, double PageH, double DrawX, double DrawY, double DrawW, double DrawH,
                                          double ContentX, double ContentY, double ContentW, double ContentH);

public readonly record struct ImageInfo(int Width, int Height, double XDpi, double YDpi, int Frames);

/// <summary>Where a one-image page file in the session folder came from, so it can be drawn without PDFium.</summary>
public sealed record ImagePageSource(string ImagePath, ImagePdfOptions Options);

/// <summary>PDF rendering (PDFium) and image → PDF layout/embedding.</summary>
public sealed class ImagePdfService
{
    public static readonly string[] ImageExtensions = { ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".webp" };
    public static bool IsImage(string path) => ImageExtensions.Contains(Path.GetExtension(path).ToLowerInvariant());
    public const string ImageFilter = "Images|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.tif;*.tiff;*.webp|All files|*.*";

    /// <summary>
    /// Pictures added to the workspace become one-image page files in the session folder. Thumbnails and previews of
    /// those pages are drawn straight from the picture (GDI+), so they never depend on PDFium and never wait on it.
    /// </summary>
    public static readonly System.Collections.Concurrent.ConcurrentDictionary<string, ImagePageSource> ImagePageSources = new(StringComparer.OrdinalIgnoreCase);

    private static Bitmap RenderImagePage(ImagePageSource src, int frame, double pxPerPt)
    {
        using var loaded = LoadImage(src.ImagePath, frame);
        var L = ComputeLayout(loaded.Bitmap.Width, loaded.Bitmap.Height, loaded.Bitmap.HorizontalResolution, loaded.Bitmap.VerticalResolution, src.Options);
        var k = Math.Min(Math.Max(0.05, pxPerPt), 8000.0 / Math.Max(L.PageW, L.PageH));
        var w = Math.Max(1, (int)Math.Round(L.PageW * k));
        var h = Math.Max(1, (int)Math.Round(L.PageH * k));
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        try
        {
            using var g = Graphics.FromImage(bmp);
            g.Clear(Color.White);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.SetClip(new RectangleF((float)(L.ContentX * k), (float)(L.ContentY * k), (float)(L.ContentW * k), (float)(L.ContentH * k)));
            g.DrawImage(loaded.Bitmap, new RectangleF((float)(L.DrawX * k), (float)(L.DrawY * k), (float)(L.DrawW * k), (float)(L.DrawH * k)));
            return bmp;
        }
        catch { bmp.Dispose(); throw; }
    }

    // ───────────────────────── PDF → image(s) ─────────────────────────

    public List<string> PdfToImages(string pdfPath, string outputDirectory, PdfToImageOptions o, Action<int, int>? progress = null)
    {
        if (!File.Exists(pdfPath)) throw new FileNotFoundException("PDF file was not found.", pdfPath);
        Directory.CreateDirectory(outputDirectory);
        var dpi = Math.Clamp(o.Dpi, 36, 1200);
        var total = GetPageCount(pdfPath);
        var pages = (o.Pages ?? Enumerable.Range(0, total).ToList()).Where(p => p >= 0 && p < total).ToList();
        var digits = Math.Max(3, total.ToString().Length);
        var prefix = string.IsNullOrWhiteSpace(o.Prefix) ? Path.GetFileNameWithoutExtension(pdfPath) : o.Prefix.Trim();
        var written = new List<string>();

        for (var i = 0; i < pages.Count; i++)
        {
            var page = pages[i];
            var target = Path.Combine(outputDirectory, $"{prefix}_{(page + 1).ToString().PadLeft(digits, '0')}.{Extension(o.Format)}");
            using var sk = RenderSk(pdfPath, page, dpi);
            switch (o.Format)
            {
                case ImageOutputFormat.Png: SaveSkia(sk, target, SKEncodedImageFormat.Png, 100); break;
                case ImageOutputFormat.Jpeg: SaveSkia(sk, target, SKEncodedImageFormat.Jpeg, o.Quality); break;
                case ImageOutputFormat.Webp: SaveSkia(sk, target, SKEncodedImageFormat.Webp, o.Quality); break;
                default:
                    using (var bmp = ToBitmap(sk, SKEncodedImageFormat.Png, 100))
                        bmp.Save(target, o.Format == ImageOutputFormat.Bmp ? ImageFormat.Bmp : o.Format == ImageOutputFormat.Tiff ? ImageFormat.Tiff : ImageFormat.Gif);
                    break;
            }
            written.Add(target);
            progress?.Invoke(i + 1, pages.Count);
        }
        return written;
    }

    /// <summary>Renders so the longest side is about <paramref name="maxSidePx"/> pixels (used for thumbnails).</summary>
    public Bitmap RenderBitmapFit(string pdfPath, int pageIndex, double widthPt, double heightPt, int maxSidePx)
    {
        var longest = Math.Max(1.0, Math.Max(widthPt, heightPt));
        return RenderBitmap(pdfPath, pageIndex, 72.0 * maxSidePx / longest);
    }

    /// <summary>Renders one page as PDFium shows it (the PDF's own /Rotate applied, user rotation NOT applied).</summary>
    public Bitmap RenderBitmap(string pdfPath, int pageIndex, double dpi)
    {
        if (ImagePageSources.TryGetValue(pdfPath, out var imgSrc))
            return RenderImagePage(imgSrc, pageIndex, Math.Clamp(Math.Round(dpi), 20, 600) / 72.0);
        using var sk = RenderSk(pdfPath, pageIndex, (int)Math.Clamp(Math.Round(dpi), 20, 600));
        return ToBitmap(sk, SKEncodedImageFormat.Jpeg, 92);
    }

    /// <summary>
    /// Same as <see cref="RenderBitmap"/> but pixel-exact: no JPEG round-trip, the integer DPI is used as given.
    /// The Edit PDF window uses it so the page text and the text it draws over it have identical sharpness.
    /// </summary>
    public Bitmap RenderBitmapLossless(string pdfPath, int pageIndex, int dpi)
    {
        if (ImagePageSources.TryGetValue(pdfPath, out var imgSrc))
            return RenderImagePage(imgSrc, pageIndex, Math.Clamp(dpi, 20, 600) / 72.0);
        using var sk = RenderSk(pdfPath, pageIndex, Math.Clamp(dpi, 20, 600));
        if (sk.ColorType == SKColorType.Bgra8888 && sk.Width > 0 && sk.Height > 0)
        {
            var bmp = new Bitmap(sk.Width, sk.Height, PixelFormat.Format32bppArgb);
            var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            try
            {
                var src = sk.Bytes;
                var rowBytes = sk.RowBytes; var copy = Math.Min(sk.Width * 4, Math.Abs(data.Stride));
                for (var y = 0; y < sk.Height; y++)
                    System.Runtime.InteropServices.Marshal.Copy(src, y * rowBytes, data.Scan0 + y * data.Stride, copy);
            }
            finally { bmp.UnlockBits(data); }
            return bmp;
        }
        return ToBitmap(sk, SKEncodedImageFormat.Png, 100);
    }

    /// <summary>PDFium is not re-entrant: every render in the app goes through this one gate.</summary>
    internal static readonly object PdfiumGate = new();

    private static SKBitmap RenderSk(string pdfPath, int pageIndex, int dpi)
    {
        // Never touch PDFtoImage when pdfium.dll is missing: its static handle would throw again from the finalizer thread.
        if (!NativeSupport.PdfiumAvailable) throw new InvalidOperationException(NativeSupport.PdfiumMissingMessage);
        lock (PdfiumGate)
        {
            using var input = File.OpenRead(pdfPath);
            return Conversion.ToImage(input, pageIndex, password: PdfPasswords.Get(pdfPath),
                options: new RenderOptions(Dpi: dpi, WithAnnotations: true, WithFormFill: true, UseTiling: true));
        }
    }

    /// <summary>True when the page has (almost) nothing printed on it. Used by "Select blank pages".</summary>
    public bool LooksBlank(string pdfPath, int pageIndex)
    {
        using var bmp = RenderBitmap(pdfPath, pageIndex, 24);
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            var stride = Math.Abs(data.Stride);
            var buf = new byte[stride * bmp.Height];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buf, 0, buf.Length);
            long ink = 0;
            for (var y = 0; y < bmp.Height; y++)
            {
                var row = y * stride;
                for (var x = 0; x < bmp.Width; x++)
                {
                    var i = row + x * 4;
                    if ((buf[i] + buf[i + 1] + buf[i + 2]) / 3 < 225) ink++;
                }
            }
            return ink <= (long)bmp.Width * bmp.Height * 0.0006;
        }
        finally { bmp.UnlockBits(data); }
    }

    private static void SaveSkia(SKBitmap bmp, string path, SKEncodedImageFormat fmt, int quality)
    {
        using var fs = File.Create(path);
        bmp.Encode(fs, fmt, Math.Clamp(quality, 1, 100));
    }

    private static Bitmap ToBitmap(SKBitmap sk, SKEncodedImageFormat fmt, int quality)
    {
        using var ms = new MemoryStream();
        sk.Encode(ms, fmt, quality);
        ms.Position = 0;
        using var tmp = new Bitmap(ms);
        return new Bitmap(tmp); // detach from the stream
    }

    public static int GetPageCount(string path)
    {
        using var document = PdfPasswords.Open(path, PdfDocumentOpenMode.Import);
        return document.PageCount;
    }

    public static string Extension(ImageOutputFormat f) => f switch
    {
        ImageOutputFormat.Jpeg => "jpg", ImageOutputFormat.Webp => "webp", ImageOutputFormat.Bmp => "bmp",
        ImageOutputFormat.Tiff => "tiff", ImageOutputFormat.Gif => "gif", _ => "png"
    };

    // ───────────────────────── image → PDF ─────────────────────────

    public static (double W, double H) PageSizeMm(ImagePdfPageSize s) => s switch
    {
        ImagePdfPageSize.A3 => (297, 420), ImagePdfPageSize.A5 => (148, 210), ImagePdfPageSize.B5 => (176, 250),
        ImagePdfPageSize.Letter => (215.9, 279.4), ImagePdfPageSize.Legal => (215.9, 355.6),
        ImagePdfPageSize.Tabloid => (279.4, 431.8), _ => (210, 297)
    };

    /// <summary>Single source of truth for page size + image placement. The dialog preview uses this too.</summary>
    public static PageImageLayout ComputeLayout(int imgW, int imgH, double xDpi, double yDpi, ImagePdfOptions o)
    {
        imgW = Math.Max(1, imgW); imgH = Math.Max(1, imgH);
        xDpi = xDpi > 1 ? xDpi : 96; yDpi = yDpi > 1 ? yDpi : 96;
        var margin = MmToPt(Math.Max(0, o.MarginMm));
        var physW = imgW * 72.0 / xDpi;
        var physH = imgH * 72.0 / yDpi;

        double pw, ph;
        if (o.PageSize == ImagePdfPageSize.FitToImage)
        {
            pw = physW + margin * 2; ph = physH + margin * 2;
            var big = Math.Max(pw, ph);
            if (big > 14400) { var k = 14400 / big; pw *= k; ph *= k; physW *= k; physH *= k; }
        }
        else
        {
            var (mw, mh) = o.PageSize == ImagePdfPageSize.Custom ? (o.CustomWidthMm, o.CustomHeightMm) : PageSizeMm(o.PageSize);
            pw = MmToPt(Math.Max(10, mw)); ph = MmToPt(Math.Max(10, mh));
            var landscape = o.Orientation == ImagePdfOrientation.Landscape || (o.Orientation == ImagePdfOrientation.Auto && imgW > imgH);
            if (o.Orientation == ImagePdfOrientation.Auto && o.PageSize == ImagePdfPageSize.Custom) landscape = pw > ph;
            if (landscape != pw > ph) (pw, ph) = (ph, pw);
        }

        var cx = Math.Min(margin, pw / 2 - 1); var cy = Math.Min(margin, ph / 2 - 1);
        var cw = Math.Max(1, pw - cx * 2); var ch = Math.Max(1, ph - cy * 2);
        double dw, dh;
        switch (o.Fit)
        {
            case ImagePdfFit.Stretch: dw = cw; dh = ch; break;
            case ImagePdfFit.Cover: { var s = Math.Max(cw / imgW, ch / imgH); dw = imgW * s; dh = imgH * s; break; }
            case ImagePdfFit.ActualSize: dw = physW; dh = physH; break;
            default: { var s = Math.Min(cw / imgW, ch / imgH); dw = imgW * s; dh = imgH * s; break; }
        }
        return new PageImageLayout(pw, ph, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh, cx, cy, cw, ch);
    }

    public void ImagesToPdf(string outputPath, IReadOnlyList<string> images, ImagePdfOptions o, Action<int, int>? progress = null)
    {
        if (images.Count == 0) throw new InvalidOperationException("Add at least one image.");
        var jobs = new List<(string Path, int Frame)>();
        foreach (var p in images)
        {
            if (!File.Exists(p)) throw new FileNotFoundException("Image file was not found.", p);
            var frames = ReadInfo(p).Frames;
            for (var f = 0; f < Math.Max(1, frames); f++) jobs.Add((p, f));
        }

        var keepAlive = new List<IDisposable>();
        try
        {
            using var doc = new PdfDocument();
            doc.Info.Title = "Images";
            doc.Info.Creator = "PDF Studio";
            for (var i = 0; i < jobs.Count; i++)
            {
                var (path, frame) = jobs[i];
                using var loaded = LoadImage(path, frame);
                var layout = ComputeLayout(loaded.Bitmap.Width, loaded.Bitmap.Height, loaded.Bitmap.HorizontalResolution, loaded.Bitmap.VerticalResolution, o);
                var xi = Embed(loaded, path, frame, keepAlive);

                var page = doc.AddPage();
                page.Width = XUnit.FromPoint(layout.PageW);
                page.Height = XUnit.FromPoint(layout.PageH);
                using (var gfx = XGraphics.FromPdfPage(page))
                {
                    gfx.IntersectClip(new XRect(layout.ContentX, layout.ContentY, layout.ContentW, layout.ContentH));
                    gfx.DrawImage(xi, layout.DrawX, layout.DrawY, layout.DrawW, layout.DrawH);
                }
                progress?.Invoke(i + 1, jobs.Count);
            }
            doc.Save(outputPath);
        }
        finally { foreach (var d in keepAlive) try { d.Dispose(); } catch { } }
    }

    private static XImage Embed(LoadedImage img, string path, int frame, List<IDisposable> keep)
    {
        XImage xi;
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if ((ext is ".jpg" or ".jpeg") && frame == 0 && !img.ExifApplied)
        {
            xi = XImage.FromFile(path); // keep original JPEG bytes: no quality loss, small output
        }
        else
        {
            var ms = new MemoryStream();
            if (ext is ".jpg" or ".jpeg") SaveJpeg(img.Bitmap, ms, 92); else img.Bitmap.Save(ms, ImageFormat.Png);
            ms.Position = 0;
            keep.Add(ms);
            xi = XImage.FromStream(ms);
        }
        keep.Add(xi);
        return xi;
    }

    private static void SaveJpeg(Bitmap bmp, Stream target, long quality)
    {
        var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var ps = new EncoderParameters(1);
        ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        // JPEG has no alpha: flatten onto white.
        using var flat = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format24bppRgb);
        flat.SetResolution(bmp.HorizontalResolution, bmp.VerticalResolution);
        using (var g = Graphics.FromImage(flat)) { g.Clear(Color.White); g.DrawImage(bmp, 0, 0, bmp.Width, bmp.Height); }
        flat.Save(target, codec, ps);
    }

    // ───────────────────────── image loading ─────────────────────────

    public sealed class LoadedImage : IDisposable
    {
        public Bitmap Bitmap { get; init; } = null!;
        public bool ExifApplied { get; init; }
        public void Dispose() => Bitmap.Dispose();
    }

    /// <summary>Loads any supported image (incl. WebP, multi-page TIFF frames, EXIF-rotated photos).</summary>
    public static LoadedImage LoadImage(string path, int frame = 0)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext != ".webp")
        {
            try
            {
                using var img = Image.FromFile(path);
                if (frame > 0) img.SelectActiveFrame(FrameDimension.Page, frame);
                var bmp = new Bitmap(img.Width, img.Height, PixelFormat.Format32bppArgb);
                bmp.SetResolution(img.HorizontalResolution > 1 ? img.HorizontalResolution : 96, img.VerticalResolution > 1 ? img.VerticalResolution : 96);
                using (var g = Graphics.FromImage(bmp)) { g.DrawImage(img, 0, 0, img.Width, img.Height); }
                var applied = ApplyExif(img, bmp);
                return new LoadedImage { Bitmap = bmp, ExifApplied = applied };
            }
            catch { /* fall through to Skia */ }
        }
        using var sk = SKBitmap.Decode(path) ?? throw new InvalidOperationException($"Could not read image \"{Path.GetFileName(path)}\".");
        var result = ToBitmap(sk, SKEncodedImageFormat.Png, 100);
        result.SetResolution(96, 96);
        return new LoadedImage { Bitmap = result };
    }

    private static bool ApplyExif(Image source, Bitmap target)
    {
        try
        {
            if (!source.PropertyIdList.Contains(0x0112)) return false;
            var o = source.GetPropertyItem(0x0112)?.Value?[0] ?? 1;
            var flip = o switch
            {
                2 => RotateFlipType.RotateNoneFlipX, 3 => RotateFlipType.Rotate180FlipNone, 4 => RotateFlipType.RotateNoneFlipY,
                5 => RotateFlipType.Rotate90FlipX, 6 => RotateFlipType.Rotate90FlipNone, 7 => RotateFlipType.Rotate270FlipX,
                8 => RotateFlipType.Rotate270FlipNone, _ => RotateFlipType.RotateNoneFlipNone
            };
            if (flip == RotateFlipType.RotateNoneFlipNone) return false;
            target.RotateFlip(flip);
            return true;
        }
        catch { return false; }
    }

    /// <summary>Cheap metadata read (no full decode) used by the dialog's live layout preview.</summary>
    public static ImageInfo ReadInfo(string path)
    {
        try
        {
            if (Path.GetExtension(path).Equals(".webp", StringComparison.OrdinalIgnoreCase)) throw new NotSupportedException();
            using var img = Image.FromFile(path);
            var w = img.Width; var h = img.Height;
            try
            {
                if (img.PropertyIdList.Contains(0x0112) && (img.GetPropertyItem(0x0112)?.Value?[0] ?? 1) >= 5) (w, h) = (h, w);
            }
            catch { }
            var frames = 1;
            try { frames = img.GetFrameCount(FrameDimension.Page); } catch { }
            return new ImageInfo(w, h, img.HorizontalResolution, img.VerticalResolution, Math.Max(1, frames));
        }
        catch
        {
            try
            {
                var info = SKBitmap.DecodeBounds(path);
                if (info.Width > 0) return new ImageInfo(info.Width, info.Height, 96, 96, 1);
            }
            catch { }
            return new ImageInfo(1000, 1000, 96, 96, 1);
        }
    }

    /// <summary>Downscaled copy for on-screen preview.</summary>
    public static Bitmap LoadPreview(string path, int maxSide = 520)
    {
        using var loaded = LoadImage(path);
        var s = Math.Min(1.0, maxSide / (double)Math.Max(loaded.Bitmap.Width, loaded.Bitmap.Height));
        var w = Math.Max(1, (int)(loaded.Bitmap.Width * s)); var h = Math.Max(1, (int)(loaded.Bitmap.Height * s));
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.DrawImage(loaded.Bitmap, 0, 0, w, h);
        return bmp;
    }

    private static double MmToPt(double mm) => mm * 72.0 / 25.4;
}
