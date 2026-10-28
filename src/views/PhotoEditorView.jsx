import PhotoEditorModal from '../modals/PhotoEditorModal.jsx';

/** Dedicated Photo Editing tab. It reuses the proven editor and export pipeline without a modal backdrop. */
export default function PhotoEditorView({ notify, onSessionChange }) {
  return <PhotoEditorModal embedded setModal={() => {}} notify={notify} onSessionChange={onSessionChange} />;
}
