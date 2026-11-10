// Standalone progressive enhancement for long schedule tables.
// No Firebase, authentication, editing or data access.
(function () {
  function setup() {
    document.querySelectorAll('.schedule-scroll-controls').forEach(toolbar => {
      const wrapper = toolbar.nextElementSibling;
      if (!wrapper || !wrapper.classList.contains('table-wrapper')) return;
      const left = toolbar.querySelector('[data-scroll="left"]');
      const right = toolbar.querySelector('[data-scroll="right"]');
      const text = toolbar.querySelector('.scroll-position');
      const refresh = () => {
        const max = Math.max(0, wrapper.scrollWidth - wrapper.clientWidth);
        const current = Math.max(0, wrapper.scrollLeft);
        if (left) left.disabled = current <= 2;
        if (right) right.disabled = current >= max - 2;
        if (text) text.textContent = max < 3 ? 'Усі дати видно' : 'Прокрутіть графік по горизонталі';
      };
      const move = direction => {
        const first = wrapper.querySelector('th:first-child');
        const labelWidth = first ? first.getBoundingClientRect().width : 160;
        const distance = Math.max(240, wrapper.clientWidth - labelWidth - 60);
        wrapper.scrollBy({left: direction * distance, behavior: 'smooth'});
      };
      left?.addEventListener('click', () => move(-1));
      right?.addEventListener('click', () => move(1));
      wrapper.addEventListener('scroll', refresh, {passive:true});
      window.addEventListener('resize', refresh, {passive:true});
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(refresh);
        observer.observe(wrapper);
        const table = wrapper.querySelector('table');
        if (table) observer.observe(table);
      }
      if (typeof MutationObserver !== 'undefined') {
        const header = wrapper.querySelector('thead');
        if (header) new MutationObserver(refresh).observe(header,{childList:true,subtree:true});
      }
      refresh();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, {once:true});
  else setup();
})();
