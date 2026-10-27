import { FileArchive, FileImage, FilePenLine, FileText, ImagePlus, Layers3 } from 'lucide-react';

export const initialTools = [
  { label: 'Edit PDF', description: 'Add text, signatures, highlights, stamps and shapes', icon: FilePenLine, tone: 'lavender', mode: 'edit' },
  { label: 'Merge & organize', description: 'Reorder, rotate, duplicate and combine pages', icon: Layers3, tone: 'lavender', mode: 'workspace' },
  { label: 'PDF to Word', description: 'Convert PDF into editable Word paragraphs, tables, and separate images', icon: FileText, tone: 'blue', action: 'word' },
  { label: 'PDF to images', description: 'Export pages as high-quality PNG or JPG', icon: FileImage, tone: 'orange', action: 'images' },
  { label: 'Compress PDF', description: 'Control size targets, DPI, quality, color mode, metadata, and output protection', icon: FileArchive, tone: 'blue', action: 'compress' },
  { label: 'Images to PDF', description: 'Build a polished PDF from your image files', icon: ImagePlus, tone: 'green', mode: 'workspace', action: 'imagesToPdf' },
];
