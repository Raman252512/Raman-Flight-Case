const nav = document.querySelector('#site-nav');
const menu = document.querySelector('.menu-toggle');
if (nav && menu) {
  menu.hidden = false;
  function setMenu(open) {
    menu.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
  }
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') === 'false'));
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menu.focus();
    }
  });
}
const photo = document.querySelector('.lightbox');
if (typeof photo?.showModal === 'function') {
  photo.querySelector('button').addEventListener('click', () => photo.close());
  photo.addEventListener('click', (event) => { if (event.target === photo) photo.close(); });
  for (const link of document.querySelectorAll('[data-gallery]')) {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const image = photo.querySelector('img');
      image.src = link.href;
      image.alt = link.querySelector('img').alt;
      photo.showModal();
    });
  }
}
const form = document.querySelector('#quote');
if (form) {
  const status = form.querySelector('.form-status');
  const submit = form.querySelector('button[type="submit"]');
  const category = new URLSearchParams(location.search).get('case');
  if ([...form.elements.caseType.options].some(({ value }) => value === category)) {
    form.elements.caseType.value = category;
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.hidden = false;
    status.dataset.state = '';
    status.textContent = 'Sending your request…';
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form))
      });
      const result = await response.json();
      status.textContent = result.message;
      status.dataset.state = response.ok ? 'success' : 'error';
      if (response.ok) form.reset();
    } catch {
      status.textContent = 'We couldn’t confirm that your request was received. Please try again or contact us on WhatsApp.';
      status.dataset.state = 'error';
    } finally {
      submit.disabled = false;
      status.focus();
    }
  });
}
