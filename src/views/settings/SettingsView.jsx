import { AnimatePresence, motion } from 'motion/react';
import { RotateCcw, Settings2 } from 'lucide-react';
import ActionButton from '../../components/common/ActionButton.jsx';
import { pageVariants } from '../../constants/motion.js';
import AppearanceTab from './AppearanceTab.jsx';
import ExportTab from './ExportTab.jsx';
import PrivacyTab from './PrivacyTab.jsx';
import SettingsNav from './SettingsNav.jsx';
import UpdatesTab from './UpdatesTab.jsx';
import WorkspaceTab from './WorkspaceTab.jsx';

export default function SettingsView({ preferences, settingsTab, updateState, readyUpdate, imageFormat, imageQuality, appVersion, setSettingsTab, setDark, setModal, setImageFormat, setImageQuality, setPreference, resetPreferences, checkForUpdates }) {
  return (
    <motion.section key="settings" className="settings-view" variants={pageVariants} initial="initial" animate="animate" exit="exit">
              <div className="settings-page-heading">
                <div><div className="eyebrow"><Settings2 size={14} /> Application preferences</div><h1>Settings</h1><p>Configure the way PDF Studio looks and behaves. Your preferences are saved on this computer.</p></div>
                <ActionButton icon={RotateCcw} onClick={resetPreferences}>Reset to defaults</ActionButton>
              </div>
              <div className="settings-layout">
    <SettingsNav settingsTab={settingsTab} setSettingsTab={setSettingsTab} />
                <div className="settings-content">
                  <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={settingsTab} className="settings-content-motion" variants={pageVariants} initial="initial" animate="animate" exit="exit">
    {settingsTab === 'appearance' && <AppearanceTab preferences={preferences} setDark={setDark} setPreference={setPreference} />}
    {settingsTab === 'workspace' && <WorkspaceTab preferences={preferences} setPreference={setPreference} />}
    {settingsTab === 'export' && <ExportTab imageFormat={imageFormat} imageQuality={imageQuality} setImageFormat={setImageFormat} setImageQuality={setImageQuality} />}
    {settingsTab === 'privacy' && <PrivacyTab appVersion={appVersion} setModal={setModal} />}
    {settingsTab === 'updates' && <UpdatesTab updateState={updateState} readyUpdate={readyUpdate} appVersion={appVersion} checkForUpdates={checkForUpdates} />}
                  </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.section>
  );
}
