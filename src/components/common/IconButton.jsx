import { cx } from '../../utils/cx.js';

export default function IconButton({ icon: Icon, label, onClick, disabled = false, active = false, className = '', size = 16, variant = 'ghost' }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active || undefined} onClick={onClick} disabled={disabled} className={cx('icon-button', `icon-button-${variant}`, active && 'is-active', className)}><Icon size={size} strokeWidth={1.85} aria-hidden="true" /></button>;
}
