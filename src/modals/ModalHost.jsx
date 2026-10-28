import { AnimatePresence } from 'motion/react';
import AboutModal from './AboutModal.jsx';
import ConfirmDeleteModal from './ConfirmDeleteModal.jsx';
import CompressionModal from './CompressionModal.jsx';
import ImageTextModal from './ImageTextModal.jsx';
import ImageConvertModal from './ImageConvertModal.jsx';
import PhotoEditorModal from './PhotoEditorModal.jsx';
import CoverModal from './CoverModal.jsx';
import ExportModal from './ExportModal.jsx';
import ExportSelectedModal from './ExportSelectedModal.jsx';
import GuideModal from './GuideModal.jsx';
import ImagesModal from './ImagesModal.jsx';
import PageMenuModal from './PageMenuModal.jsx';
import PagePreviewModal from './PagePreviewModal.jsx';
import ReviewModal from './ReviewModal.jsx';
import SplitModal from './SplitModal.jsx';
import TextModal from './TextModal.jsx';
import UpdateReadyModal from './UpdateReadyModal.jsx';
import WordModal from './WordModal.jsx';

export default function ModalHost({ workspaceName, workspacePath, hideGuide, setHideGuide, pages, sources, guideStep, setGuideStep, chooseFiles, readyUpdate, applyingUpdate, modal, textValue, textColor, textSize, coverColor, exportTitle, exportAuthor, exportPageNumbers, exportWatermarkMode, exportWatermark, exportWatermarkOpacity, exportWatermarkAngle, exportWatermarkColor, exportPaperSize, exportCompression, exportPassword, imageFormat, imageQuality, appVersion, selectedPages, setSelectedIds, setActiveId, setMode, setSettingsTab, setModal, setTextValue, setTextColor, setTextSize, setCoverColor, setExportTitle, setExportAuthor, setExportPageNumbers, setExportWatermarkMode, setExportWatermark, setExportWatermarkOpacity, setExportWatermarkAngle, setExportWatermarkColor, setExportPaperSize, setExportCompression, setExportPassword, setImageFormat, setImageQuality, deleteSelected, requestDeleteSelected, rotateSelected, duplicateSelected, addTextOverlay, addCoverOverlay, doExportPdf, convertToWord, compressPdfFile, convertToImages, splitPdf, deferReadyUpdate, applyReadyUpdate, notify }) {
  return (
    <>
    <AnimatePresence mode="sync" initial={false}>
    {modal?.type === 'confirm-delete' && <ConfirmDeleteModal key="confirm-delete" modal={modal} setModal={setModal} deleteSelected={deleteSelected} />}
    {modal?.type === 'export' && <ExportModal key="export" pages={pages} exportTitle={exportTitle} exportAuthor={exportAuthor} exportPageNumbers={exportPageNumbers} exportWatermarkMode={exportWatermarkMode} exportWatermark={exportWatermark} exportWatermarkOpacity={exportWatermarkOpacity} exportWatermarkAngle={exportWatermarkAngle} exportWatermarkColor={exportWatermarkColor} exportPaperSize={exportPaperSize} exportCompression={exportCompression} exportPassword={exportPassword} setModal={setModal} setExportTitle={setExportTitle} setExportAuthor={setExportAuthor} setExportPageNumbers={setExportPageNumbers} setExportWatermarkMode={setExportWatermarkMode} setExportWatermark={setExportWatermark} setExportWatermarkOpacity={setExportWatermarkOpacity} setExportWatermarkAngle={setExportWatermarkAngle} setExportWatermarkColor={setExportWatermarkColor} setExportPaperSize={setExportPaperSize} setExportCompression={setExportCompression} setExportPassword={setExportPassword} doExportPdf={doExportPdf} />}
    {modal?.type === 'export-selected' && <ExportSelectedModal key="export-selected" selectedPages={selectedPages} setModal={setModal} doExportPdf={doExportPdf} />}
    {modal?.type === 'word' && <WordModal key="word" file={modal.file || null} pages={pages} setModal={setModal} convertToWord={convertToWord} />}
    {modal?.type === 'imageText' && <ImageTextModal key="imageText" setModal={setModal} notify={notify} />}
    {modal?.type === 'imageConvert' && <ImageConvertModal key="imageConvert" setModal={setModal} notify={notify} />}
    {modal?.type === 'photoEditor' && <PhotoEditorModal key="photoEditor" setModal={setModal} notify={notify} />}
    {modal?.type === 'compress' && <CompressionModal key="compress" setModal={setModal} compressPdfFile={compressPdfFile} />}
    {modal?.type === 'images' && <ImagesModal key="images" file={modal.file || null} workspaceName={workspaceName} workspacePath={workspacePath} pages={pages} imageFormat={imageFormat} imageQuality={imageQuality} selectedPages={selectedPages} setModal={setModal} setImageFormat={setImageFormat} setImageQuality={setImageQuality} convertToImages={convertToImages} />}
    {modal?.type === 'split' && <SplitModal key="split" file={modal.file || null} workspaceName={workspaceName} workspacePath={workspacePath} pages={pages} setModal={setModal} splitPdf={splitPdf} />}
    {modal?.type === 'text' && <TextModal key="text" textValue={textValue} textColor={textColor} textSize={textSize} setModal={setModal} setTextValue={setTextValue} setTextColor={setTextColor} setTextSize={setTextSize} addTextOverlay={addTextOverlay} />}
    {modal?.type === 'cover' && <CoverModal key="cover" coverColor={coverColor} setModal={setModal} setCoverColor={setCoverColor} addCoverOverlay={addCoverOverlay} />}
    {modal?.type === 'page-menu' && <PageMenuModal key="page-menu" modal={modal} setSelectedIds={setSelectedIds} setActiveId={setActiveId} setModal={setModal} requestDeleteSelected={requestDeleteSelected} rotateSelected={rotateSelected} duplicateSelected={duplicateSelected} />}
    {modal?.type === 'page-preview' && <PagePreviewModal key="page-preview" pages={pages} sources={sources} modal={modal} setModal={setModal} setActiveId={setActiveId} setSelectedIds={setSelectedIds} />}
    {modal?.type === 'guide' && <GuideModal key="guide" guideStep={guideStep} setGuideStep={setGuideStep} setMode={setMode} setSettingsTab={setSettingsTab} setModal={setModal} chooseFiles={chooseFiles} hideGuide={hideGuide} setHideGuide={setHideGuide} />}
    {modal?.type === 'about' && <AboutModal key="about" appVersion={appVersion} setMode={setMode} setSettingsTab={setSettingsTab} setModal={setModal} />}
    {modal?.type === 'review' && <ReviewModal key="review" setModal={setModal} notify={notify} />}
    </AnimatePresence>
    <AnimatePresence>
    {readyUpdate && <UpdateReadyModal key={`update-ready-${readyUpdate.version}`} readyUpdate={readyUpdate} applyingUpdate={applyingUpdate} deferReadyUpdate={deferReadyUpdate} applyReadyUpdate={applyReadyUpdate} />}
    </AnimatePresence>
    </>
  );
}
