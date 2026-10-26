import { Plus } from 'lucide-react';
import { cx } from '../../utils/cx.js';

export default function AddPagesCard({ pagesRef, draggingPageId, dropCue, setDropCue, chooseFiles, handleBrowserFiles, movePage }) {
  return (
    <button type="button" className={cx('page-add-card', dropCue?.id === '__end__' && 'page-add-hover')} onClick={chooseFiles} onDragOver={(event) => {
      const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
      if (draggedId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropCue((cue) => cue?.id === '__end__' ? cue : { id: '__end__', position: 'after' }); }
      else if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.currentTarget.classList.add('page-add-hover'); }
    }} onDragLeave={(event) => { event.currentTarget.classList.remove('page-add-hover'); setDropCue((cue) => cue?.id === '__end__' ? null : cue); }} onDrop={(event) => {
      const draggedId = event.dataTransfer?.getData('application/x-pdfstudio-page') || draggingPageId;
      event.currentTarget.classList.remove('page-add-hover');
      if (draggedId && pagesRef.current.length) { event.preventDefault(); event.stopPropagation(); const lastPage = [...pagesRef.current].reverse().find((page) => page.id !== draggedId); if (lastPage) movePage(draggedId, lastPage.id, 'after'); }
      else if (event.dataTransfer?.files?.length) { event.preventDefault(); event.stopPropagation(); handleBrowserFiles([...event.dataTransfer.files]); }
      setDropCue(null);
    }} aria-label="Add PDF or image pages">
      <span className="page-add-icon"><Plus size={24} strokeWidth={1.8} /></span><strong>Add pages</strong><span>PDF or image</span><kbd>Browse files</kbd>
    </button>
  );
}
