/*
 * Title-bar tab compatibility for a prebuilt renderer that predates the React tab UI.
 * On current source builds, TitleBar.jsx already renders .titlebar-tabs and this module exits.
 * Kept as a small progressive enhancement so previously built dist files can use the same in-app editor.
 */
(() => {
  if (window.__PDF_STUDIO_TABS_COMPAT__) return;
  window.__PDF_STUDIO_TABS_COMPAT__ = true;

  const routes = {
    home: 'Overview',
    workspace: 'Page workspace',
    edit: 'Edit PDF',
    convert: 'Conversion studio',
    history: 'Recent sources',
    settings: 'Application settings',
  };
  const routeForLabel = Object.fromEntries(Object.entries(routes).map(([id, label]) => [label.toLowerCase(), id]));
  routeForLabel['edit pdf'] = 'edit';
  let editorTabOpen = false;
  let activeRoute = 'home';
  let lastMainRoute = 'home';
  let tabStrip;
  let editorTabWrap;

  const currentRoute = () => {
    const active = document.querySelector('.sidebar .nav-item[aria-current="page"]');
    return routeForLabel[(active?.getAttribute('aria-label') || active?.textContent || '').trim().toLowerCase()] || 'home';
  };
  const navButton = (route) => {
    const label = routes[route] || 'Overview';
    return [...document.querySelectorAll('.sidebar .nav-item')].find((button) => {
      const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
      return aria === label.toLowerCase() || (route === 'settings' && aria === 'application settings');
    });
  };
  const goTo = (route) => {
    const button = navButton(route);
    if (button) button.click();
  };
  const svg = (path) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const icons = {
    home: svg('M4 5.5A1.5 1.5 0 0 1 5.5 4h4A1.5 1.5 0 0 1 11 5.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5z M13 5.5A1.5 1.5 0 0 1 14.5 4h4A1.5 1.5 0 0 1 20 5.5v4A1.5 1.5 0 0 1 18.5 11h-4A1.5 1.5 0 0 1 13 9.5z M4 14.5A1.5 1.5 0 0 1 5.5 13h4A1.5 1.5 0 0 1 11 14.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5z M13 14.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5z'),
    edit: svg('M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z'),
    add: svg('M12 5v14M5 12h14'),
    close: svg('M18 6 6 18M6 6l12 12'),
  };
  const setButtonContent = (button, iconName, label) => {
    button.innerHTML = `${icons[iconName]}<span class="titlebar-tab-label"></span>`;
    button.querySelector('.titlebar-tab-label').textContent = label;
  };
  const ensureStyles = () => {
    if (document.getElementById('pdfstudio-tabs-compat-style')) return;
    const style = document.createElement('style');
    style.id = 'pdfstudio-tabs-compat-style';
    style.textContent = `
      .titlebar { justify-content:flex-start!important; gap:8px!important; padding-left:16px!important; background:#f4f6f9!important; }
      .titlebar-brand { flex:0 0 196px!important; width:196px!important; min-width:0!important; }
      .titlebar-tabs { display:flex; flex:1 1 auto; align-self:stretch; align-items:stretch; gap:3px; min-width:0; padding:7px 0 0 2px; overflow:hidden; -webkit-app-region:drag; }
      .titlebar-tab { position:relative; display:flex; align-items:center; gap:8px; height:100%; min-width:0; max-width:260px; flex:0 1 205px; padding:0 30px 0 12px; border:1px solid transparent; border-bottom:0; border-radius:9px 9px 0 0; background:transparent; color:#647086; text-align:left; -webkit-app-region:no-drag; }
      .titlebar-tab:hover:not(.is-active) { background:#e9edf3; color:#303b4b; }
      .titlebar-tab.is-active,.titlebar-tab-wrap.is-active .titlebar-tab { background:#fff; color:#283446; border-color:#dce2e9; box-shadow:0 1px 0 #fff; }
      .titlebar-tab[aria-selected="true"]:before { content:""; position:absolute; top:-1px; left:11px; right:11px; height:2px; border-radius:2px 2px 0 0; background:var(--accent,#6253df); }
      .titlebar-tab svg { width:15px; height:15px; flex:0 0 auto; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
      .titlebar-tab>svg { color:#8072dc; }
      .titlebar-tab-label { display:block; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:12px; font-weight:650; }
      .titlebar-tab-wrap { position:relative; display:flex; align-items:stretch; flex:0 1 250px; min-width:130px; max-width:290px; }
      .titlebar-tab-wrap .titlebar-tab { flex:1 1 auto; width:100%; }
      .titlebar-tab-close { position:absolute; top:50%; right:5px; display:grid; place-items:center; width:23px; height:23px; padding:0; transform:translateY(-40%); border:0; border-radius:6px; background:transparent; color:#7b8494; -webkit-app-region:no-drag; }
      .titlebar-tab-close svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; }
      .titlebar-tab-close:hover { background:#e7e9ef; color:#283446; }
      .titlebar-tab-add { align-self:center; display:grid; place-items:center; width:28px; height:28px; flex:0 0 28px; margin-left:1px; padding:0; border:0; border-radius:8px; background:transparent; color:#6f7c8f; -webkit-app-region:no-drag; }
      .titlebar-tab-add svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; }
      .titlebar-tab-add:hover { background:#e6eaf1; color:var(--accent,#6253df); }
      .titlebar-center { flex:0 0 auto!important; justify-content:flex-start!important; gap:8px!important; margin:0 12px 0 4px!important; font-size:11px!important; white-space:nowrap; }
      .app-body.app-body-edit .sidebar { display:none!important; }
      .app-body.app-body-edit .main-panel { width:100%; min-width:0; overflow:hidden; }
      .app-body.app-body-edit .main-panel>.topbar { display:none!important; }
      .app-body.app-body-edit .persistent-edit-pdf { flex:1 1 auto; width:100%; min-height:0; }
      .app-shell.theme-dark .titlebar { background:#202329!important; border-color:#343a44!important; }
      .app-shell.theme-dark .titlebar-tab { color:#b1bbca; }
      .app-shell.theme-dark .titlebar-tab:hover:not(.is-active) { background:#2a3039; color:#edf1f6; }
      .app-shell.theme-dark .titlebar-tab.is-active,.app-shell.theme-dark .titlebar-tab-wrap.is-active .titlebar-tab { background:#252a32; border-color:#3a414c; color:#edf1f6; box-shadow:0 1px 0 #252a32; }
      .app-shell.theme-dark .titlebar-tab-close { color:#aab4c2; }
      .app-shell.theme-dark .titlebar-tab-close:hover,.app-shell.theme-dark .titlebar-tab-add:hover { background:#363b46; color:#e9ecf4; }
      @media(max-width:980px) { .titlebar-brand { flex-basis:178px!important; width:178px!important; } .titlebar-center { display:none!important; } .titlebar-tab-wrap { flex-basis:210px; } }
      @media(max-width:680px) { .titlebar { gap:4px!important; } .titlebar-brand { flex-basis:48px!important; width:48px!important; } .titlebar-brand .brand-wordmark { display:none!important; } .titlebar-tabs { gap:2px; } .titlebar-tab { flex-basis:130px; padding-left:9px; gap:6px; } .titlebar-tab-wrap { flex-basis:165px; min-width:100px; } .titlebar-tab-label { font-size:11px; } }
      @media(max-width:520px) { .titlebar-tab-main { flex-basis:42px; padding:0 10px; } .titlebar-tab-main .titlebar-tab-label { display:none; } .titlebar-tab-wrap { flex:1 1 130px; min-width:82px; } .titlebar-tab-wrap .titlebar-tab { padding-left:8px; padding-right:28px; } .window-controls button { width:36px!important; } }
    `;
    document.head.appendChild(style);
  };
  const sync = () => {
    const root = document.querySelector('.app-shell');
    const body = document.querySelector('.app-body');
    if (!root || !body || !tabStrip) return;
    const route = currentRoute();
    if (route === 'edit' && activeRoute !== 'edit') lastMainRoute = activeRoute === 'edit' ? lastMainRoute : activeRoute;
    if (route === 'edit') editorTabOpen = true;
    activeRoute = route;
    body.classList.toggle('app-body-edit', route === 'edit');
    const mainTab = tabStrip.querySelector('.titlebar-tab-main');
    if (mainTab) {
      const isActive = route !== 'edit';
      mainTab.classList.toggle('is-active', isActive);
      mainTab.setAttribute('aria-selected', String(isActive));
    }
    const wrapper = tabStrip.querySelector('.titlebar-tab-wrap');
    if (wrapper) {
      wrapper.classList.toggle('is-active', route === 'edit');
      const tab = wrapper.querySelector('[role="tab"]');
      tab?.classList.toggle('is-active', route === 'edit');
      tab?.setAttribute('aria-selected', String(route === 'edit'));
    }
    if (editorTabWrap && editorTabOpen) editorTabWrap.style.display = '';
  };
  const createTabs = () => {
    const bar = document.querySelector('.titlebar');
    const brand = bar?.querySelector('.titlebar-brand');
    if (!bar || !brand || bar.querySelector('.titlebar-tabs')) return Boolean(bar?.querySelector('.titlebar-tabs'));
    ensureStyles();
    window.__PDF_STUDIO_TABS_COMPAT_ACTIVE__ = true;
    tabStrip = document.createElement('div');
    tabStrip.className = 'titlebar-tabs';
    tabStrip.setAttribute('role', 'tablist');
    tabStrip.setAttribute('aria-label', 'PDF Studio tabs');

    const mainTab = document.createElement('button');
    mainTab.type = 'button'; mainTab.className = 'titlebar-tab titlebar-tab-main is-active';
    mainTab.setAttribute('role', 'tab'); mainTab.setAttribute('aria-selected', 'true');
    setButtonContent(mainTab, 'home', 'PDF Studio');
    mainTab.title = 'Return to your main workspace';
    mainTab.addEventListener('click', () => { if (currentRoute() === 'edit') goTo(lastMainRoute); });
    tabStrip.appendChild(mainTab);

    const addButton = document.createElement('button');
    addButton.type = 'button'; addButton.className = 'titlebar-tab-add'; addButton.setAttribute('aria-label', 'Open Edit PDF tab'); addButton.title = 'Open Edit PDF tab';
    addButton.innerHTML = icons.add;
    addButton.addEventListener('click', () => goTo('edit'));
    tabStrip.appendChild(addButton);
    editorTabWrap = null;
    const center = bar.querySelector('.titlebar-center');
    if (center) bar.insertBefore(tabStrip, center); else bar.insertBefore(tabStrip, bar.querySelector('.window-controls'));
    // Add the tab only when the route is actually opened, so the initial layout remains uncluttered.
    const observer = new MutationObserver(() => {
      const route = currentRoute();
      if (route === 'edit' && !editorTabOpen) { editorTabOpen = true; attachEditorTab(); }
      if (route !== 'edit' && activeRoute === 'edit') { /* keep tab open when switching away */ }
      sync();
    });
    observer.observe(document.querySelector('.sidebar') || bar.parentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'class'] });
    // The primary tab uses the last selected main route, while the Edit PDF tab remains available after switching away.
    sync();
    return true;
  };
  const attachEditorTab = () => {
    if (!tabStrip || tabStrip.querySelector('.titlebar-tab-wrap')) return;
    tabStrip.querySelector('.titlebar-tab-add')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'titlebar-tab-wrap is-active';
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'titlebar-tab titlebar-tab-editor is-active'; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', 'true'); tab.title = 'Edit PDF';
    setButtonContent(tab, 'edit', 'Edit PDF');
    tab.addEventListener('click', () => goTo('edit'));
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'titlebar-tab-close'; close.setAttribute('aria-label', 'Close Edit PDF tab'); close.title = 'Close tab'; close.innerHTML = icons.close;
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      const routeBeforeClose = currentRoute();
      const dirty = Boolean(document.querySelector('.ep-btn-primary .ep-dot'));
      if (dirty && !window.confirm('You have unsaved PDF edits. Close the Edit PDF tab and discard those changes?')) return;
      editorTabOpen = false;
      wrap.remove(); editorTabWrap = null;
      if (!tabStrip.querySelector('.titlebar-tab-add')) {
        const add = document.createElement('button'); add.type='button'; add.className='titlebar-tab-add'; add.setAttribute('aria-label','Open Edit PDF tab'); add.title='Open Edit PDF tab'; add.innerHTML=icons.add; add.addEventListener('click',()=>goTo('edit')); tabStrip.appendChild(add);
      }
      if (routeBeforeClose === 'edit') goTo(lastMainRoute);
      sync();
    });
    wrap.append(tab, close); tabStrip.appendChild(wrap); editorTabWrap = wrap;
    sync();
  };
  // Runtime patch only attaches to the old built renderer. A current source build owns the tabs in React.
  const attempt = () => {
    if (document.querySelector('.titlebar-tabs')) return true;
    return createTabs();
  };
  if (!attempt()) {
    const observer = new MutationObserver(() => { if (attempt()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Keep the editor tab caption meaningful when a file gets opened in the old bundle.
  const titleObserver = new MutationObserver(() => {
    const label = editorTabWrap?.querySelector('.titlebar-tab-label');
    if (!label) return;
    const pageName = document.querySelector('.ep-header h1')?.textContent?.trim();
    label.textContent = pageName && pageName !== 'Edit PDF' ? pageName : 'Edit PDF';
  });
  titleObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  // The compatibility renderer predates the source-level onCloseTab shortcut.
  window.addEventListener('keydown', (event) => {
    if (!window.__PDF_STUDIO_TABS_COMPAT_ACTIVE__) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'w' || currentRoute() !== 'edit') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    tabStrip?.querySelector('.titlebar-tab-close')?.click();
  }, true);
})();
