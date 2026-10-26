import { FileImage, FilePenLine, FileText, ImagePlus, Layers3 } from 'lucide-react';

export const initialTools = [
  { label: 'Edit PDF', description: 'Add text, signatures, highlights, stamps and shapes', icon: FilePenLine, tone: 'lavender', mode: 'edit' },
  { label: 'Merge & organize', description: 'Reorder, rotate, duplicate and combine pages', icon: Layers3, tone: 'lavender', mode: 'workspace' },
  { label: 'PDF to Word', description: 'Turn selectable PDF text into an editable DOCX', icon: FileText, tone: 'blue', action: 'word' },
  { label: 'PDF to images', description: 'Export pages as high-quality PNG or JPG', icon: FileImage, tone: 'orange', action: 'images' },
  { label: 'Images to PDF', description: 'Build a polished PDF from your image files', icon: ImagePlus, tone: 'green', mode: 'workspace' },
];
