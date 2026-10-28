import { FileArchive, FileImage, FilePenLine, FileText, ImageDown, ImagePlus, Layers3, ScanSearch } from 'lucide-react';

export const initialTools = [
  { label: 'Edit PDF', description: 'Add text, signatures, highlights, stamps and shapes', icon: FilePenLine, tone: 'lavender', mode: 'edit' },
  { label: 'Merge & organize', description: 'Reorder, rotate, duplicate and combine pages', icon: Layers3, tone: 'lavender', mode: 'workspace' },
  { label: 'PDF to Word', description: 'Convert PDF into editable Word paragraphs, tables, and separate images', icon: FileText, tone: 'blue', action: 'word' },
  { label: 'PDF to images', description: 'Export pages as high-quality PNG or JPG', icon: FileImage, tone: 'orange', action: 'images' },
  { label: 'Compress PDF', description: 'Control size targets, DPI, quality, color mode, metadata, and output protection', icon: FileArchive, tone: 'blue', action: 'compress' },
  { label: 'Images to PDF', description: 'Build a polished PDF from your image files', icon: ImagePlus, tone: 'green', mode: 'workspace', action: 'imagesToPdf' },
  { label: 'Image to text', description: 'Extract text (OCR) from photos, screenshots and scans, then copy or save it', icon: ScanSearch, tone: 'lavender', action: 'imageText' },
  { label: 'Format converter', description: 'Convert HEIC, WebP, PNG, JPG and more. Shrink to a size limit and strip hidden location data', icon: ImageDown, tone: 'green', action: 'imageConvert' },
];
