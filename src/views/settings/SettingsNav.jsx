import { motion } from 'motion/react';
import { ChevronRight, ShieldCheck, SlidersHorizontal, FileOutput, Sun, MonitorDown } from 'lucide-react';
import { interactiveSpring } from '../../constants/motion.js';
import { cx } from '../../utils/cx.js';

export default function SettingsNav({ settingsTab, setSettingsTab }) {
  return (
    <nav className="settings-nav" aria-label="Settings categories">
      <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'appearance' && 'settings-nav-active')} onClick={() => setSettingsTab('appearance')}><Sun size={18}/><span><strong>Appearance</strong><small>Theme and readability</small></span>{settingsTab === 'appearance' && <ChevronRight size={16}/>}</motion.button>
      <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'workspace' && 'settings-nav-active')} onClick={() => setSettingsTab('workspace')}><SlidersHorizontal size={18}/><span><strong>Workspace</strong><small>Page tools and safeguards</small></span>{settingsTab === 'workspace' && <ChevronRight size={16}/>}</motion.button>
      <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'export' && 'settings-nav-active')} onClick={() => setSettingsTab('export')}><FileOutput size={18}/><span><strong>Files & export</strong><small>Default image output</small></span>{settingsTab === 'export' && <ChevronRight size={16}/>}</motion.button>
      <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'privacy' && 'settings-nav-active')} onClick={() => setSettingsTab('privacy')}><ShieldCheck size={18}/><span><strong>Privacy & about</strong><small>Local processing and shortcuts</small></span>{settingsTab === 'privacy' && <ChevronRight size={16}/>}</motion.button>
      <motion.button whileHover={{ x: 2 }} whileTap={{ scale: 0.99 }} transition={interactiveSpring} className={cx('settings-nav-item', settingsTab === 'updates' && 'settings-nav-active')} onClick={() => setSettingsTab('updates')}><MonitorDown size={18}/><span><strong>Updates & downloads</strong><small>Automatic checks and verified updates</small></span>{settingsTab === 'updates' && <ChevronRight size={16}/>}</motion.button>
    </nav>
  );
}
