export default function SettingToggle({ title, description, checked, onChange }) {
  return <label className="setting-toggle-row"><span className="setting-toggle-copy"><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="setting-switch" aria-hidden="true" /></label>;
}
