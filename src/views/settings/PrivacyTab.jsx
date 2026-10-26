import { Activity, ArrowUpRight, CheckCircle2, CircleHelp, HardDrive, ShieldCheck } from 'lucide-react';

export default function PrivacyTab({ appVersion, setModal }) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-title"><span className="settings-symbol settings-symbol-green"><ShieldCheck size={18}/></span><div><h2>Privacy & file handling</h2><p>Your documents are processed locally by this desktop build.</p></div></div>
      <div className="privacy-detail-row"><span className="privacy-detail-icon"><CheckCircle2 size={18}/></span><div><strong>Local-first processing</strong><p>Imported document bytes stay in the current application session; this build has no document upload or account sign-in workflow.</p></div></div>
      <div className="privacy-detail-row"><span className="privacy-detail-icon"><HardDrive size={18}/></span><div><strong>Preferences stored on this computer</strong><p>Theme, readability, workspace behavior and export defaults are saved in the app's local settings storage.</p></div></div>
      <div className="privacy-detail-row"><span className="privacy-detail-icon"><Activity size={18}/></span><div><strong>App session reporting</strong><p>For usage and update management, PDF Studio sends its version, a random installation and session ID, operating system, computer hostname, local network IP address, session start time and elapsed time. Document contents, file names and PDF data are not sent.</p></div></div>
      <div className="settings-note"><CircleHelp size={18}/><div><strong>About PDF Studio</strong><p>Version {appVersion} · Organize PDF and image pages, then export or convert them locally. PDF-to-Word extracts selectable text; scanned pages may require OCR, which is not included.</p><button className="inline-link-button" onClick={() => setModal({ type: 'about' })}>View application details <ArrowUpRight size={14}/></button></div></div>
    </div>
  );
}
