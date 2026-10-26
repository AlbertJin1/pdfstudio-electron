import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, FilePenLine, FolderOpen, History, Info, Keyboard,
  Layers3, LayoutDashboard, Pause, Play, Settings2, ShieldCheck, Sparkles, Download, WandSparkles, X,
} from 'lucide-react';

/* Each step: which view to show, which live UI element to spotlight (union of all matches),
   and an optional "try it" action. If a target is missing (e.g. empty workspace) the card centers. */
const STEPS = [
  { id: 'welcome', icon: Sparkles, title: 'Welcome to PDF Studio', mode: 'home', targets: [],
    body: 'This quick tour points at the real buttons and panels so you know exactly where everything is. Use Next, or the arrow keys, to move along.',
    tips: ['Everything is processed on this computer.', 'Press Esc any time to leave the tour.'] },
  { id: 'nav', icon: LayoutDashboard, title: 'Move around with the sidebar', mode: 'home', targets: ['.sidebar .nav-item'],
    body: 'Overview, Page workspace, Edit PDF, Convert files, Recent sources, and Settings live here. Ctrl+1, Ctrl+2, Ctrl+3, Ctrl+4, and Ctrl+5 open Overview, Page workspace, Convert files, Recent sources, and Settings respectively.',
    tips: ['Edit PDF has a dedicated sidebar item and keeps its edits while you move between sections.', 'The number next to Page workspace shows how many pages are loaded.'] },
  { id: 'open', icon: FolderOpen, title: 'Open your files', mode: 'home', targets: ['.welcome-actions'],
    body: 'Choose Open documents (Ctrl+O) or drag files anywhere into the window. PDFs, images (PNG, JPG, WEBP, BMP, GIF, TIFF) and DOCX are supported, and you can mix several files.',
    tips: ['You can also use the + next to “Your documents” in the sidebar.'],
    action: { label: 'Choose files now', icon: FolderOpen, run: 'chooseFiles' } },
  { id: 'tools', icon: WandSparkles, title: 'Pick a common task', mode: 'home', targets: ['.tool-card-grid'],
    body: 'These cards start the most common jobs. If nothing is loaded yet they ask you to choose a file first.',
    tips: ['Cards that need pages are ready once a file is open.'] },
  { id: 'toolbar', icon: Layers3, title: 'Edit pages in the toolbar', mode: 'workspace', targets: ['.workspace-toolbar', '.workspace-empty'],
    body: 'Undo and redo, rotate, duplicate, delete, add text, add a cover block, or insert a blank page. Actions apply to the pages you have selected.',
    tips: ['Ctrl+Z undoes, Ctrl+Shift+Z redoes.', 'Delete or Backspace removes the selected pages.'] },
  { id: 'grid', icon: Layers3, title: 'Arrange pages in the grid', mode: 'workspace', targets: ['.page-grid-panel', '.workspace-empty'],
    body: 'Click a page to select it, Ctrl-click for several, and drag pages to reorder them. The preview panel on the right shows the active page.',
    tips: ['Use the left and right arrow keys to step through pages.'] },
  { id: 'edit-pdf', icon: FilePenLine, title: 'Edit PDF content', mode: 'home', targets: ['.tool-card-grid'],
    body: 'Edit PDF opens in its own window. Click existing text or images to edit them in the same font, size and colour, add new text and images, sign, highlight and draw, and line everything up with rulers, guides, margins and snapping.',
    tips: ['Ctrl+Z / Ctrl+Y undo and redo, Ctrl+S saves a new PDF, Ctrl+plus / minus / 0 zoom, and Space-drag pans the page.', 'Whiteout only covers what you see. It is not secure redaction, and covered original text remains in the file.'] },
  { id: 'export', icon: Download, title: 'Export when you are ready', mode: 'workspace', targets: ['.workspace-heading-actions'],
    body: 'Add files brings in more sources. Merge & export PDF (Ctrl+S) saves the pages in their current order, with paper size, diagonal watermark, optional AES-256 password protection, and compression options.',
    tips: ['Right-click style page menus can export just the selected pages.'] },
  { id: 'convert', icon: WandSparkles, title: 'Convert and split', mode: 'convert', targets: ['.conversion-grid'],
    body: 'Turn a PDF into Word, export pages as PNG or JPG, or split a document by individual pages, fixed groups, or custom ranges.',
    tips: ['PDF to Word extracts selectable text; complex layouts may need cleanup.'] },
  { id: 'history', icon: History, title: 'Review your loaded sources', mode: 'history', targets: ['.sidebar .nav-item:nth-of-type(5)'],
    body: 'Recent sources lists the files in this session with type, size and page count, and jumps back to any of them.',
    tips: ['This is the current session only, not a cloud history.'] },
  { id: 'settings', icon: Settings2, title: 'Make it yours', mode: 'settings', settingsTab: 'appearance', targets: ['.sidebar .nav-item:nth-of-type(6)'],
    body: 'Settings has themes, accent colors, text size, density, delete confirmation, default image export options, shortcuts, and update checks.',
    tips: ['You can switch light/dark with the sun/moon button in the top bar.'] },
  { id: 'help', icon: Info, title: 'Guide and About buttons', mode: 'home', targets: ['[data-tour="help"]', '[data-tour="about"]'],
    body: 'The ? button reopens this guide whenever you need it. The i button opens About, with version info and update access.',
    tips: ['Turn off “Show guide on startup” below, or in Settings → Workspace.'] },
  { id: 'shortcuts', icon: Keyboard, title: 'Handy shortcuts', mode: 'home', targets: [],
    body: 'Ctrl+A select all pages · arrows move between pages (Shift extends) · Ctrl+arrows reorder selected pages · Ctrl+D duplicate · R / Shift+R rotate · Delete remove · Ctrl+Shift+N blank page · Ctrl+F find · Ctrl+S export in Page workspace or save in Edit PDF · Ctrl+Z / Ctrl+Y undo and redo · F1 reopens this guide.',
    tips: [] },
  { id: 'done', icon: ShieldCheck, title: 'You are ready', mode: 'home', targets: [],
    body: 'Open a file, arrange your pages, then export or convert. Your documents stay on this device.',
    tips: ['Tick “Don’t show this guide again” if you don’t want it at launch.'] },
];

const PAD = 8;
const unionRect = (selectors) => {
  let box = null;
  for (const selector of selectors) {
    let nodes = [];
    try { nodes = [...document.querySelectorAll(selector)]; } catch { /* ignore bad selector */ }
    for (const node of nodes) {
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      box = box ? { l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
  }
  if (!box) return null;
  return { left: box.l - PAD, top: box.t - PAD, width: box.r - box.l + PAD * 2, height: box.b - box.t + PAD * 2 };
};
const sameRect = (a, b) => (!a && !b) || (a && b && ['left', 'top', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 1));

export default function GuideModal({ guideStep = 0, setGuideStep, setMode, setSettingsTab, setModal, chooseFiles, hideGuide, setHideGuide }) {
  const index = Math.max(0, Math.min(STEPS.length - 1, guideStep));
  const step = STEPS[index];
  const Icon = step.icon;
  const last = index === STEPS.length - 1;
  const cardRef = useRef(null);
  const [rect, setRect] = useState(null);
  const [cardPos, setCardPos] = useState(null);
  const [autoplay, setAutoplay] = useState(true);
  const [hovered, setHovered] = useState(false);
  const AUTO_MS = 5000;

  const close = useCallback(() => setModal(null), [setModal]);
  const go = useCallback((n) => setGuideStep(Math.max(0, Math.min(STEPS.length - 1, n))), [setGuideStep]);
  const finish = useCallback(() => { setGuideStep(0); setModal(null); }, [setGuideStep, setModal]);

  // Navigate the real app to the area this step explains.
  useEffect(() => {
    setMode(step.mode);
    if (step.settingsTab) setSettingsTab(step.settingsTab);
  }, [step, setMode, setSettingsTab]);

  // Track the spotlight target (views animate in, windows resize), scroll it into view once found.
  useEffect(() => {
    setRect(null);
    let scrolled = false;
    const measure = () => {
      const next = step.targets.length ? unionRect(step.targets) : null;
      if (next && !scrolled) {
        scrolled = true;
        const first = step.targets.map((s) => document.querySelector(s)).find(Boolean);
        first?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
      setRect((prev) => (sameRect(prev, next) ? prev : next));
    };
    measure();
    const timer = setInterval(measure, 120);
    window.addEventListener('resize', measure);
    return () => { clearInterval(timer); window.removeEventListener('resize', measure); };
  }, [step]);

  // Place the card next to the spotlight, clamped inside the window.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const vw = window.innerWidth; const vh = window.innerHeight;
    const w = card.offsetWidth; const h = card.offsetHeight; const gap = 14; const m = 12;
    if (!rect) { setCardPos({ left: Math.max(m, (vw - w) / 2), top: Math.max(m, (vh - h) / 2) }); return; }
    const clampX = (x) => Math.min(Math.max(m, x), vw - w - m);
    const clampY = (y) => Math.min(Math.max(m, y), vh - h - m);
    const spots = [
      { ok: rect.top + rect.height + gap + h <= vh - m, left: clampX(rect.left + rect.width / 2 - w / 2), top: rect.top + rect.height + gap },
      { ok: rect.left + rect.width + gap + w <= vw - m, left: rect.left + rect.width + gap, top: clampY(rect.top) },
      { ok: rect.top - gap - h >= m, left: clampX(rect.left + rect.width / 2 - w / 2), top: rect.top - gap - h },
      { ok: rect.left - gap - w >= m, left: rect.left - gap - w, top: clampY(rect.top) },
    ];
    const pick = spots.find((s) => s.ok);
    setCardPos(pick ? { left: pick.left, top: pick.top } : { left: clampX(vw - w - 24), top: clampY(vh - h - 24) });
  }, [rect, index]);

  // Keyboard: arrows move, Esc closes (Esc is also handled globally).
  useEffect(() => {
    const onKey = (event) => {
      if (event.target?.matches?.('input[type="text"], textarea, select')) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); last ? finish() : go(index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
      else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, last, go, finish, close]);

  useEffect(() => { cardRef.current?.focus({ preventScroll: true }); }, [index]);

  const runAction = () => {
    if (step.action?.run === 'chooseFiles') chooseFiles();
  };

  return (
    <motion.div className="tour-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
      <div className="tour-blocker" onMouseDown={(e) => e.stopPropagation()} />
      {rect
        ? <div className="tour-spotlight" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
        : <div className="tour-dim" />}
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="tour-card"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={cardPos ? { left: cardPos.left, top: cardPos.top } : { visibility: 'hidden' }}
      >
        <div className="tour-head">
          <span className="tour-icon"><Icon size={18} /></span>
          <div className="tour-head-copy"><small>STEP {index + 1} OF {STEPS.length}</small><h2 id="tour-title">{step.title}</h2></div>
          <button type="button" className="tour-x" onClick={close} aria-label="Close guide" title="Close guide (Esc)"><X size={16} /></button>
        </div>
        {autoplay && !last && <div className="tour-progress" aria-hidden="true"><span key={`${index}`} style={{ animationDuration: `${AUTO_MS}ms`, animationPlayState: hovered ? 'paused' : 'running' }} onAnimationEnd={() => go(index + 1)} /></div>}
        <p className="tour-body">{step.body}</p>
        {step.tips.length > 0 && <ul className="tour-tips">{step.tips.map((t) => <li key={t}><CheckCircle2 size={14} /><span>{t}</span></li>)}</ul>}
        {step.action && <button type="button" className="tour-try" onClick={runAction}>{step.action.icon && <step.action.icon size={15} />}{step.action.label}<ArrowUpRight size={14} /></button>}
        <div className="tour-dots" role="tablist" aria-label="Guide steps">
          {STEPS.map((s, i) => <button type="button" role="tab" aria-selected={i === index} key={s.id} className={`tour-dot${i === index ? ' is-active' : ''}${i < index ? ' is-done' : ''}`} onClick={() => go(i)} aria-label={`Step ${i + 1}: ${s.title}`} title={s.title} />)}
        </div>
        <label className="tour-optout">
          <input type="checkbox" checked={Boolean(hideGuide)} onChange={(e) => setHideGuide(e.target.checked)} />
          <span className="tour-check" aria-hidden="true" />
          <span>Don’t show this guide again</span>
        </label>
        <div className="tour-actions">
          <button type="button" className="tour-btn tour-skip" onClick={close}>Skip tour</button>
          <span className="tour-spacer" />
          {!last && <button type="button" className="tour-btn tour-icon-btn" onClick={() => setAutoplay((v) => !v)} aria-label={autoplay ? 'Pause automatic tour' : 'Resume automatic tour'} title={autoplay ? 'Pause auto-advance' : 'Resume auto-advance'}>{autoplay ? <Pause size={15} /> : <Play size={15} />}</button>}
          <button type="button" className="tour-btn" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={15} />Back</button>
          {last
            ? <button type="button" className="tour-btn tour-primary" onClick={finish}><CheckCircle2 size={15} />Finish</button>
            : <button type="button" className="tour-btn tour-primary" onClick={() => go(index + 1)}>Next<ChevronRight size={15} /></button>}
        </div>
      </div>
    </motion.div>
  );
}
