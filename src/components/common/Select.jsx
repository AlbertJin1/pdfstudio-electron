import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../../utils/cx.js';

/**
 * Custom dropdown that replaces the native <select> everywhere in the app.
 *
 *   <Select value={dpi} onChange={setDpi} options={[{ value: 150, label: 'Standard', hint: '150 DPI' }]} ariaLabel="Resolution" />
 *
 * options: { value, label, hint?, disabled?, group?, style? }[]  (consecutive options with the same `group` share a header)
 * onChange receives the option's original value (numbers stay numbers).
 * className lands on the trigger button, so existing field styles (form-input, ep-select, ...) keep working.
 *
 * Keyboard: Enter / Space / ArrowDown / ArrowUp open; arrows, Home, End, PageUp/PageDown move; Enter or Space picks;
 * Escape closes (without closing the dialog around it); Tab closes; typing jumps to a matching option.
 * The list is portalled to the app shell so dialogs never clip it, and flips above the field when space is short.
 */
export default function Select({ value, onChange, options, id, ariaLabel, ariaLabelledBy, disabled = false, placeholder = 'Select…', className = '', listClassName = '', title, minListWidth = 0 }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typeahead = useRef({ text: '', timer: 0 });
  const baseId = useId().replace(/:/g, '');
  const listId = `${baseId}-list`;

  const selectedIndex = useMemo(() => options.findIndex((option) => String(option.value) === String(value)), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const enabledIndexes = useMemo(() => options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0), [options]);

  const close = useCallback((refocus = false) => {
    setOpen(false); setActive(-1);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const openList = useCallback(() => {
    if (disabled || !options.length) return;
    setActive(selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : (enabledIndexes[0] ?? -1));
    setOpen(true);
  }, [disabled, enabledIndexes, options, selectedIndex]);

  const choose = useCallback((index) => {
    const option = options[index];
    if (!option || option.disabled) return;
    close(true);
    if (String(option.value) !== String(value)) onChange?.(option.value);
  }, [close, onChange, options, value]);

  // Position next to the trigger; flip above when there is more room there.
  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const wanted = Math.min(320, (listRef.current?.scrollHeight || 240) + 8);
    const flip = below < Math.min(wanted, 200) && above > below;
    const maxHeight = Math.max(120, Math.min(320, flip ? above : below));
    const width = Math.min(Math.max(rect.width, minListWidth), window.innerWidth - margin * 2);
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
    setPlace({ left, width, maxHeight, ...(flip ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  }, [minListWidth]);

  useLayoutEffect(() => { if (open) reposition(); }, [open, reposition, options.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // A click on the <label> that wraps this field re-clicks the button itself; don't close-then-reopen.
      const label = triggerRef.current?.closest('label');
      if (label && label.contains(target)) return;
      close(false);
    };
    const onScroll = (event) => { if (!listRef.current?.contains(event.target)) close(false); };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onResize);
    };
  }, [close, open]);

  // Keep the highlighted option visible.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, place]);

  useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

  const move = (step) => {
    if (!enabledIndexes.length) return;
    const position = enabledIndexes.indexOf(active);
    const next = position < 0 ? (step > 0 ? 0 : enabledIndexes.length - 1) : Math.min(enabledIndexes.length - 1, Math.max(0, position + step));
    setActive(enabledIndexes[next]);
  };

  const onKeyDown = (event) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(key)) { event.preventDefault(); event.stopPropagation(); openList(); }
      return;
    }
    // While the list is open it owns the keyboard; nothing may reach the dialog or global shortcuts behind it.
    event.stopPropagation();
    if (key === 'Escape') { event.preventDefault(); close(true); }
    else if (key === 'Tab') close(false);
    else if (key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (key === 'PageDown') { event.preventDefault(); move(8); }
    else if (key === 'PageUp') { event.preventDefault(); move(-8); }
    else if (key === 'Home') { event.preventDefault(); setActive(enabledIndexes[0] ?? -1); }
    else if (key === 'End') { event.preventDefault(); setActive(enabledIndexes[enabledIndexes.length - 1] ?? -1); }
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); if (key === ' ' && typeahead.current.text) typeaheadAdd(' '); else choose(active); }
    else if (key.length === 1) { event.preventDefault(); typeaheadAdd(key); }
  };

  function typeaheadAdd(char) {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = window.setTimeout(() => { state.text = ''; }, 700);
    const start = Math.max(0, enabledIndexes.indexOf(active));
    const ordered = [...enabledIndexes.slice(start + (state.text.length === 1 ? 1 : 0)), ...enabledIndexes.slice(0, start + (state.text.length === 1 ? 1 : 0))];
    const hit = ordered.find((index) => String(options[index].label).toLowerCase().startsWith(state.text));
    if (hit !== undefined) setActive(hit);
  }

  const portalTarget = open ? (triggerRef.current?.closest('.app-shell, .pdf-editor-window-root') || document.body) : null;

  return (
    <>
      <button ref={triggerRef} type="button" id={id} role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${baseId}-opt-${active}` : undefined} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} title={title}
        disabled={disabled} className={cx('ui-select-trigger', open && 'is-open', !selected && 'is-placeholder', className)}
        onClick={() => (open ? close(false) : openList())} onKeyDown={onKeyDown}>
        <span className="ui-select-value">{selected ? selected.label : placeholder}</span>
        <ChevronDown className="ui-select-chevron" size={15} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && portalTarget && createPortal(
        <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className={cx('ui-select-list', listClassName)}
          style={{ left: place?.left, top: place?.top, bottom: place?.bottom, width: place?.width, maxHeight: place?.maxHeight, visibility: place ? 'visible' : 'hidden' }}
          onMouseDown={(event) => event.preventDefault() /* keep focus on the trigger */}>
          {options.map((option, index) => {
            const header = option.group && option.group !== options[index - 1]?.group ? <div key={`g-${index}`} className="ui-select-group" role="presentation">{option.group}</div> : null;
            const isSelected = index === selectedIndex;
            return [header,
              <div key={`${option.value}-${index}`} id={`${baseId}-opt-${index}`} data-index={index} role="option" aria-selected={isSelected} aria-disabled={option.disabled || undefined}
                className={cx('ui-select-option', index === active && 'is-active', isSelected && 'is-selected', option.disabled && 'is-disabled')} style={option.style}
                onMouseMove={() => { if (!option.disabled && active !== index) setActive(index); }} onClick={() => choose(index)}>
                <span className="ui-select-option-copy"><span className="ui-select-option-label">{option.label}</span>{option.hint && <small>{option.hint}</small>}</span>
                {isSelected && <Check size={15} strokeWidth={2.4} aria-hidden="true" />}
              </div>];
          })}
        </div>, portalTarget)}
    </>
  );
}
