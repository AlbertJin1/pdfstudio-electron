import { HardDrive, FileOutput } from 'lucide-react';
import { cx } from '../../utils/cx.js';

export default function ExportTab({ imageFormat, imageQuality, setImageFormat, setImageQuality }) {
  return (
    <div className="settings-panel">
                    <div className="settings-panel-title"><span className="settings-symbol settings-symbol-blue"><FileOutput size={18}/></span><div><h2>Files & export</h2><p>Set defaults for page-image exports. PDF export continues to ask where to save each file.</p></div></div>
                    <div className="settings-field"><div className="settings-field-heading"><strong>Default image format</strong><small>Used whenever you open the “Export pages as images” tool.</small></div><div className="settings-segment"><button className={cx(imageFormat === 'png' && 'segment-selected')} onClick={() => setImageFormat('png')}><span>PNG</span><small>Lossless · ideal for text</small></button><button className={cx(imageFormat === 'jpeg' && 'segment-selected')} onClick={() => setImageFormat('jpeg')}><span>JPEG</span><small>Smaller · ideal for photos</small></button></div></div>
                    {imageFormat === 'jpeg' && <><div className="settings-divider"/><div className="settings-field"><div className="settings-field-heading"><strong>JPEG image quality</strong><small>Higher quality preserves detail but creates larger files.</small></div><div className="settings-range"><input aria-label="Default JPEG quality" type="range" min="40" max="100" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)}/><strong>{imageQuality}%</strong></div><div className="range-ends"><span>Smaller files</span><span>Better quality</span></div></div></>}
                    <div className="settings-note"><HardDrive size={18}/><div><strong>Save location</strong><p>PDF Studio opens a save dialog or folder chooser for exports. It does not silently overwrite your files.</p></div></div>
                  </div>
  );
}
