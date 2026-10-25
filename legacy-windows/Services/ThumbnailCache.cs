using PdfStudio.Models;

namespace PdfStudio.Services;

/// <summary>
/// LRU cache of page thumbnails. Rendering is lazy (only pages that are on screen) and strictly serialised.
/// Thumbnails are cached per source page, so reordering/rotating never re-renders. Finished thumbnails fade in.
/// </summary>
public sealed class ThumbnailCache : IDisposable
{
    private const int Capacity = 180;
    private const int ThumbMaxSide = 520;
    public const int FadeMs = 260;

    private readonly ImagePdfService renderer = new();
    private readonly Dictionary<string, Bitmap> map = new();
    private readonly Dictionary<string, long> loadedAt = new();
    private readonly LinkedList<string> lru = new();
    private readonly HashSet<string> failed = new();
    private readonly object gate = new();
    private readonly Queue<(string Key, string Path, int Index, double W, double H)> queue = new();
    private readonly HashSet<string> pending = new();
    private HashSet<string> wanted = new();
    private readonly SynchronizationContext fallbackUi = SynchronizationContext.Current ?? new SynchronizationContext();
    private Control? owner;
    private bool running, disposed;

    /// <summary>Raised on the UI thread when a thumbnail becomes available.</summary>
    public event Action? Updated;

    /// <summary>The control used to hop back onto the UI thread when a render finishes.</summary>
    public void Attach(Control control) => owner = control;

    public Bitmap? TryGet(PageItem page)
    {
        if (page.IsBlank) return null;
        var key = page.ThumbKey;
        if (map.TryGetValue(key, out var bmp))
        {
            lru.Remove(key); lru.AddFirst(key);
            return bmp;
        }
        return null;
    }

    /// <summary>0 → 1 while a freshly rendered thumbnail fades in; 1 once it is settled.</summary>
    public float Fade(PageItem page)
    {
        if (!loadedAt.TryGetValue(page.ThumbKey, out var t)) return 1f;
        var e = Environment.TickCount64 - t;
        if (e >= FadeMs) { loadedAt.Remove(page.ThumbKey); return 1f; }
        var x = Math.Max(0f, e / (float)FadeMs);
        return 1f - (1f - x) * (1f - x); // ease-out
    }

    public bool HasFailed(PageItem page) => failed.Contains(page.ThumbKey);

    /// <summary>Forget failures so the next paint tries again (e.g. after a password was entered).</summary>
    public void RetryFailed() { failed.Clear(); Updated?.Invoke(); }

    public void Request(PageItem page)
    {
        if (page.IsBlank) return;
        var key = page.ThumbKey;
        var (w, h) = page.DisplaySizePt(false);
        lock (gate)
        {
            if (disposed || map.ContainsKey(key) || failed.Contains(key) || !pending.Add(key)) return;
            queue.Enqueue((key, page.SourcePath, page.SourcePageIndex, w, h));
            if (running) return;
            running = true;
        }
        Task.Run(Worker);
    }

    /// <summary>Tells the worker which thumbnails are currently on screen; anything else queued is skipped.</summary>
    public void SetWanted(HashSet<string> keys) { lock (gate) wanted = keys; }

    private void Deliver(Action action)
    {
        var o = owner;
        if (o is { IsDisposed: false, IsHandleCreated: true })
        {
            try { o.BeginInvoke(action); return; } catch { }
        }
        fallbackUi.Post(_ => action(), null);
    }

    private void Worker()
    {
        while (true)
        {
            (string Key, string Path, int Index, double W, double H) job;
            lock (gate)
            {
                if (disposed || queue.Count == 0) { running = false; return; }
                job = queue.Dequeue();
                if (!wanted.Contains(job.Key)) { pending.Remove(job.Key); continue; }
            }

            Bitmap? bmp = null;
            try { bmp = renderer.RenderBitmapFit(job.Path, job.Index, job.W, job.H, ThumbMaxSide); }
            catch { }

            var done = job; var result = bmp;
            Deliver(() =>
            {
                lock (gate) pending.Remove(done.Key);
                if (disposed) { result?.Dispose(); return; }
                if (result is null) failed.Add(done.Key);
                else
                {
                    if (map.TryGetValue(done.Key, out var old)) { old.Dispose(); lru.Remove(done.Key); }
                    map[done.Key] = result; lru.AddFirst(done.Key);
                    loadedAt[done.Key] = Environment.TickCount64;
                    while (map.Count > Capacity && lru.Last is { } last)
                    {
                        if (wanted.Contains(last.Value)) break; // never evict something on screen
                        map[last.Value].Dispose(); map.Remove(last.Value); lru.RemoveLast();
                    }
                }
                Updated?.Invoke();
            });
        }
    }

    public void Dispose()
    {
        lock (gate) { disposed = true; queue.Clear(); }
        foreach (var b in map.Values) b.Dispose();
        map.Clear(); lru.Clear();
    }
}
