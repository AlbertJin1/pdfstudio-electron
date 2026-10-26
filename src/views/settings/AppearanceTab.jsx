import { Check, CheckCircle2, Sun } from 'lucide-react';
import SettingToggle from '../../components/common/SettingToggle.jsx';
import { ACCENT_PRESETS } from '../../constants/accents.js';
import { cx } from '../../utils/cx.js';

export default function AppearanceTab({ preferences, dark, setDark, setPreference }) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-title"><span className="settings-symbol"><Sun size={18}/></span><div><h2>Appearance</h2><p>Use a theme and interface scale that are comfortable to read.</p></div></div>
      <div className="settings-field"><div className="settings-field-heading"><strong>Color mode</strong><small>Choose the surface style for your workspace.</small></div><div className="theme-choice-row settings-theme-options"><button className={cx('theme-choice', !dark && 'theme-choice-active')} onClick={() => setDark(false)}><span className="theme-preview theme-preview-light"><i/><i/><i/></span><span><strong>Light</strong><small>Bright, high-clarity surfaces</small></span>{!dark && <CheckCircle2 size={18}/>}</button><button className={cx('theme-choice', dark && 'theme-choice-active')} onClick={() => setDark(true)}><span className="theme-preview theme-preview-dark"><i/><i/><i/></span><span><strong>Dark</strong><small>Comfortable in low light</small></span>{dark && <CheckCircle2 size={18}/>}</button></div></div>
      <div className="settings-divider"/>
      <div className="settings-field"><div className="settings-field-heading"><strong>Accent color</strong><small>Personalize selected navigation, primary buttons, focus rings, and active controls.</small></div><div className="accent-preset-grid" role="group" aria-label="Accent color presets">{ACCENT_PRESETS.map((preset) => <button type="button" key={preset.id} className={cx('accent-preset', preferences.accentTheme === preset.id && 'accent-preset-active')} onClick={() => setPreference('accentTheme', preset.id)} aria-pressed={preferences.accentTheme === preset.id}><span className="accent-preset-swatch" style={{ '--swatch-color': preset.color, '--swatch-soft': preset.soft }}><span>{preferences.accentTheme === preset.id ? <Check size={15}/> : null}</span></span><strong>{preset.label}</strong>{preferences.accentTheme === preset.id && <CheckCircle2 size={15} className="accent-preset-check"/>}</button>)}</div></div>
      <div className="settings-divider"/>
      <div className="settings-field"><div className="settings-field-heading"><strong>Interface text size</strong><small>Scale menus, settings, labels, and controls across the app.</small></div><div className="settings-segment text-scale-options"><button className={cx(preferences.fontScale === 'standard' && 'segment-selected')} onClick={() => setPreference('fontScale', 'standard')}><span className="segment-demo-small">Aa</span><span>Standard</span><small>100%</small></button><button className={cx(preferences.fontScale === 'large' && 'segment-selected')} onClick={() => setPreference('fontScale', 'large')}><span className="segment-demo-large">Aa</span><span>Large</span><small>115%</small></button><button className={cx(preferences.fontScale === 'xlarge' && 'segment-selected')} onClick={() => setPreference('fontScale', 'xlarge')}><span className="segment-demo-xlarge">Aa</span><span>Extra large</span><small>130%</small></button></div></div>
      <div className="settings-divider"/>
      <div className="settings-field"><div className="settings-field-heading"><strong>Workspace density</strong><small>Choose more breathing room or fit more page cards on screen.</small></div><div className="settings-segment"><button className={cx(preferences.density === 'comfortable' && 'segment-selected')} onClick={() => setPreference('density', 'comfortable')}><span>Comfortable</span><small>More spacing</small></button><button className={cx(preferences.density === 'compact' && 'segment-selected')} onClick={() => setPreference('density', 'compact')}><span>Compact</span><small>More content</small></button></div></div>
      <div className="settings-divider"/>
      <SettingToggle title="Increase contrast" description="Strengthen boundaries, text contrast, and focus indicators for easier scanning." checked={preferences.highContrast} onChange={(value) => setPreference('highContrast', value)}/>
      <div className="settings-divider"/>
      <SettingToggle title="Reduce motion" description="Reduce transitions and movement effects for a calmer interface." checked={preferences.reduceMotion} onChange={(value) => setPreference('reduceMotion', value)}/>
    </div>
  );
}
