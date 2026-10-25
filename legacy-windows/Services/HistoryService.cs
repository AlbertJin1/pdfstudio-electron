using PdfStudio.Models;

namespace PdfStudio.Services;

public sealed class HistoryService
{
    private readonly Stack<PageSnapshot> _undo = new();
    private readonly Stack<PageSnapshot> _redo = new();
    public bool CanUndo => _undo.Count > 0;
    public bool CanRedo => _redo.Count > 0;
    public void Push(PageSnapshot current) { _undo.Push(current.Clone()); _redo.Clear(); }
    public PageSnapshot? Undo(PageSnapshot current)
    {
        if (!CanUndo) return null;
        _redo.Push(current.Clone());
        return _undo.Pop().Clone();
    }
    public PageSnapshot? Redo(PageSnapshot current)
    {
        if (!CanRedo) return null;
        _undo.Push(current.Clone());
        return _redo.Pop().Clone();
    }
    public void Clear() { _undo.Clear(); _redo.Clear(); }
}
