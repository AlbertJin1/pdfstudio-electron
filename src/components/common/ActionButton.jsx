import { LoaderCircle } from 'lucide-react';
import { cx } from '../../utils/cx.js';

/**
 * Every text button in the app goes through this component so hierarchy, sizing, focus and disabled states stay uniform.
 * variant: primary | secondary | ghost | danger     size: sm | md | lg     iconPosition: start | end
 */
export default function ActionButton({ icon: Icon, children, onClick, disabled = false, loading = false, variant = 'secondary', size = 'md', iconPosition = 'start', className = '', type = 'button', ...rest }) {
  const iconNode = loading ? <LoaderCircle size={16} strokeWidth={1.9} className="button-spinner" aria-hidden="true" /> : Icon ? <Icon size={16} strokeWidth={1.9} aria-hidden="true" /> : null;
  return <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} onClick={onClick} className={cx('action-button', `action-${variant}`, size !== 'md' && `action-${size}`, loading && 'is-loading', className)} {...rest}>{iconPosition === 'start' && iconNode}<span className="action-label">{children}</span>{iconPosition === 'end' && iconNode}</button>;
}
