"""Controls injected into the generated map, communicating with its embedding page."""

BOOKMARK_SCRIPT = r"""<script>
(() => {
  if (window.parent === window || !document.referrer) return;
  const parentOrigin = new URL(document.referrer).origin;
  let state = { authenticated: false, items: [] };
  const controls = [];
  function update() {
    for (const {button, kind, text} of controls) {
      const saved = state.items.some(item => item.kind === kind && item.text === text);
      button.textContent = saved ? '★' : '☆';
      button.title = state.authenticated
        ? (saved ? 'Könyvjelző eltávolítása' : 'Könyvjelző hozzáadása')
        : 'A könyvjelzőzéshez jelentkezz be';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(saved));
    }
  }
  for (const [selector, kind] of [['.l2 > summary > .t', 'question'], ['.l3 > .t', 'answer']]) {
    document.querySelectorAll(selector).forEach(node => {
      const text = node.textContent.trim();
      if (!text) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = 'margin-left:6px;padding:1px 5px;line-height:1.3';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        window.parent.postMessage({type:'esstorah-bookmark-toggle', kind, text}, parentOrigin);
      });
      node.after(button);
      controls.push({button, kind, text});
    });
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    if (event.data?.type === 'esstorah-bookmark-fonts' && typeof event.data.styles === 'string') {
      let style = document.getElementById('esstorah-parent-fonts');
      if (!style) {
        style = document.createElement('style');
        style.id = 'esstorah-parent-fonts';
        document.head.appendChild(style);
      }
      style.textContent = event.data.styles;
      return;
    }
    if (event.data?.type !== 'esstorah-bookmark-state') return;
    state = event.data;
    update();
  });
  update();
  window.parent.postMessage({type:'esstorah-bookmark-ready'}, parentOrigin);
})();
</script>"""
