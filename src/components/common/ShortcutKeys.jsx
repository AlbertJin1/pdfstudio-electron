export default function ShortcutKeys({ keys = [], mod = 'Ctrl' }) {
  const pieces = [];
  if (mod) pieces.push(<kbd className="shortcut-mod-key" key="modifier">{mod}</kbd>);
  keys.forEach((key, index) => {
    if (mod || index > 0) pieces.push(<span className="shortcut-plus" key={`plus-${index}`} aria-hidden="true">+</span>);
    pieces.push(<kbd key={`key-${index}`}>{key}</kbd>);
  });
  const readable = `${mod ? `${mod} + ` : ''}${keys.join(' + ')}`;
  return <span className="shortcut-keys" aria-label={readable}>{pieces}</span>;
}
