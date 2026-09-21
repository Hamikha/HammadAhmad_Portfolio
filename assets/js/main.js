// UI behaviour. Everything here is progressive enhancement: the page reads fine without it.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const mobileNav = matchMedia('(max-width: 1000px)');

/* ---------- header, mobile menu ---------- */
const header = $('.site-header');
const menuBtn = $('.menu-btn');
const nav = $('#site-nav');

function setMenu(open) {
  if (open === nav.classList.contains('is-open')) return;
  menuBtn.setAttribute('aria-expanded', String(open));
  $('.menu-label', menuBtn).textContent = open ? 'Close' : 'Menu';
  nav.classList.toggle('is-open', open);
  for (const el of [$('main'), $('.site-footer')]) el.inert = open;
  root.style.overflow = open ? 'hidden' : '';
  if (open) $('a', nav).focus({ preventScroll: true });
}
menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
mobileNav.addEventListener('change', () => setMenu(false));

/* ---------- current section: nav marker ---------- */
const navLinks = $$('.nav-list a');
const marker = $('.nav-marker');
const sections = navLinks.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean);
let current;

function placeMarker() {
  const a = navLinks.find(l => l.hasAttribute('aria-current'));
  marker.classList.toggle('is-on', Boolean(a) && !mobileNav.matches);
  if (a) marker.style.setProperty('--mx', `${a.offsetLeft + 2}px`);
}

function onScrollFrame() {
  // Read layout first, then write, so a scroll frame never forces a synchronous reflow.
  const line = innerHeight * 0.4;
  let id = null;
  for (const s of sections) if (s.getBoundingClientRect().top <= line) id = s.id;
  header.classList.toggle('is-scrolled', scrollY > 24);
  if (id !== current) {
    current = id;
    navLinks.forEach(a => (a.hash === `#${id}` ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
    placeMarker();
  }
}
let scrollQueued = false;
addEventListener('scroll', () => {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; onScrollFrame(); });
}, { passive: true });
addEventListener('resize', placeMarker);
document.fonts?.ready.then(placeMarker);
onScrollFrame();

/* ---------- reveal on enter (once) ---------- */
const io = new IntersectionObserver(entries => {
  let i = 0;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.style.transitionDelay = `${Math.min(i++ * 70, 280)}ms`;
    e.target.classList.add('in');
    io.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px' });
$$('.reveal, .h2').forEach(el => io.observe(el));

/* ---------- projects: expandable rows + filter ---------- */
const projects = $$('.pj');

function setProject(pj, open) {
  pj.classList.toggle('is-open', open);
  $('.pj-toggle', pj).setAttribute('aria-expanded', String(open));
  $('.pj-body', pj).inert = !open;
}
projects.forEach(pj => {
  setProject(pj, false);
  pj.style.viewTransitionName = pj.id;
  $('.pj-toggle', pj).addEventListener('click', () => setProject(pj, !pj.classList.contains('is-open')));
});

const chips = $$('.chip');
const filterStatus = $('.filter-status');
function applyFilter(filter) {
  let shown = 0;
  chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.filter === filter)));
  projects.forEach(pj => {
    const show = filter === 'all' || pj.dataset.cat === filter;
    pj.hidden = !show;
    if (show) { shown++; pj.classList.add('in'); }
  });
  filterStatus.textContent = `Showing ${shown} project${shown === 1 ? '' : 's'}`;
}
chips.forEach(chip => chip.addEventListener('click', () => {
  const run = () => applyFilter(chip.dataset.filter);
  if (document.startViewTransition && !reduced.matches) document.startViewTransition(run);
  else run();
}));

/* ---------- in-page links: open and highlight what they point at ---------- */
function land(target) {
  if (target.classList.contains('pj')) {
    if (target.hidden) applyFilter('all');
    setProject(target, true);
    target.classList.add('is-flash');
    setTimeout(() => target.classList.remove('is-flash'), 1600);
    $('.pj-toggle', target).focus({ preventScroll: true });
  } else if (target.classList.contains('xp-item')) {
    target.classList.add('is-target');
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    setTimeout(() => target.classList.remove('is-target'), 1800);
  }
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  const target = a && a.hash.length > 1 && document.getElementById(a.hash.slice(1));
  if (!target) return;
  closePop(false);
  setTimeout(() => land(target), 0); // after the browser's own fragment navigation, so focus sticks
});

/* ---------- skills: link each skill to the evidence ---------- */
const pop = document.createElement('div');
pop.className = 'sk-pop';
pop.id = 'sk-pop';
pop.hidden = true;
let popBtn = null;
let hoverTimer = 0;

function describe(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (el.classList.contains('pj')) return { name: $('.pj-name', el).textContent, kind: 'Project' };
  return { name: $('.xp-org', el).textContent.split(' · ')[0], kind: $('.xp-role', el).textContent };
}

$$('.sk[data-ev]').forEach(span => {
  const ids = span.dataset.ev.split(' ').filter(id => document.getElementById(id));
  if (!ids.length) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sk';
  btn.dataset.ev = ids.join(' ');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'sk-pop');
  btn.setAttribute('aria-label', `${span.textContent}, used in ${ids.length} ${ids.length === 1 ? 'place' : 'places'}`);
  const label = document.createElement('span');
  label.className = 'sk-label';
  label.textContent = span.textContent;
  const count = document.createElement('sup');
  count.textContent = ids.length;
  btn.append(label, count);
  span.replaceWith(btn);
});

function openPop(btn) {
  if (popBtn === btn) return;
  closePop(false);
  popBtn = btn;
  const label = document.createElement('span');
  label.className = 'mono';
  label.textContent = 'Used in';
  const list = document.createElement('ul');
  for (const id of btn.dataset.ev.split(' ')) {
    const info = describe(id);
    if (!info) continue;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${id}`;
    const kind = document.createElement('span');
    kind.textContent = info.kind;
    a.append(info.name, kind);
    li.append(a);
    list.append(li);
  }
  pop.replaceChildren(label, list);
  pop.style.left = '0px';
  btn.parentElement.append(pop);
  pop.hidden = false;
  const overflow = pop.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
  if (overflow > 0) pop.style.left = `${-overflow}px`;
  requestAnimationFrame(() => pop.classList.add('is-open'));
  btn.setAttribute('aria-expanded', 'true');
}

function closePop(restoreFocus) {
  if (!popBtn) return;
  const btn = popBtn;
  popBtn = null;
  pop.classList.remove('is-open');
  pop.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) btn.focus();
}

const hoverable = matchMedia('(hover: hover) and (pointer: fine)');
$$('button.sk').forEach(btn => {
  const li = btn.parentElement;
  btn.addEventListener('click', () => (popBtn === btn ? closePop(false) : openPop(btn)));
  li.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse' || !hoverable.matches) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openPop(btn), 90);
  });
  li.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (popBtn === btn && !li.contains(document.activeElement)) closePop(false); }, 180);
  });
  li.addEventListener('focusout', e => { if (popBtn === btn && !li.contains(e.relatedTarget)) closePop(false); });
});
document.addEventListener('click', e => { if (popBtn && !e.target.closest('.sk-list li')) closePop(false); });

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (nav.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
  else if (popBtn) closePop(true);
});

/* ---------- contact: copy email, local time ---------- */
const copyBtn = $('.copy');
const copyStatus = $('.copy-status');
copyBtn?.addEventListener('click', async () => {
  let label = 'Copied';
  try {
    await navigator.clipboard.writeText(copyBtn.dataset.copy);
    copyStatus.textContent = 'Email address copied';
  } catch {
    getSelection().selectAllChildren($('.mail'));
    label = 'Selected';
    copyStatus.textContent = 'Email address selected. Press Control C to copy';
  }
  copyBtn.textContent = label;
  copyBtn.classList.add('is-done');
  setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('is-done'); copyStatus.textContent = ''; }, 2200);
});

const clock = $('.clock');
if (clock) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const tick = () => { clock.textContent = fmt.format(new Date()); };
  tick();
  setInterval(tick, 30000);
}

/* ---------- the point cloud ---------- */
function noWebgl() { root.classList.add('no-webgl'); }

async function startScan() {
  const canvas = $('#scan');
  if (!canvas) return;
  try {
    const { createScan } = await import('./scan.js');
    const probe = $('.probe'), probeRead = $('.probe-read');
    const dbh = $('.dbh'), dbhText = $('.dbh-text');
    const hudStatus = $('.hud-status'), hudCount = $('.hud-count');
    const steps = $$('.step');
    const nf = new Intl.NumberFormat('en-US');
    let probeOn = false, dbhOn = false, dbhW = 0, readAt = 0;
    addEventListener('resize', () => { dbhW = 0; });

    const scan = await createScan({
      canvas,
      hero: $('.hero'),
      stage: $('.research-stage'),
      reduced,
      ui: {
        setHud(text, count, done) {
          hudStatus.textContent = text;
          hudStatus.classList.toggle('is-done', done);
          hudCount.textContent = nf.format(count);
        },
        setStep(n) { steps.forEach(s => s.classList.toggle('is-active', Number(s.dataset.step) === n)); },
        setMeasure({ dbh: d, height }) { dbhText.textContent = `DBH ${Math.round(d * 100)} cm · H ${height.toFixed(1)} m`; dbhW = 0; },
        setDbh(pos, opacity) {
          if (!pos) { if (dbhOn) { dbh.style.opacity = '0'; dbhOn = false; } return; }
          dbhOn = true;
          // Keep the label on screen: flip it left of the ring, or nudge it in on narrow screens.
          if (!dbhW) dbhW = dbh.offsetWidth; // measured once, not every frame
          const w = dbhW, vw = innerWidth;
          let x = pos[0], flip = false;
          if (x + w > vw - 8) {
            if (pos[0] - w - 18 >= 8) { x = pos[0] - w - 18; flip = true; } else x = vw - w - 8;
          }
          dbh.classList.toggle('is-flip', flip);
          dbh.style.opacity = opacity.toFixed(3);
          dbh.style.transform = `translate3d(${x.toFixed(1)}px, ${pos[1].toFixed(1)}px, 0) translateY(-50%)`;
        },
        setProbe(pos, opacity, text) {
          if (!pos) { if (probeOn) { probe.style.opacity = '0'; probeOn = false; } return; }
          probeOn = true;
          probe.style.opacity = opacity.toFixed(3);
          probe.style.transform = `translate3d(${pos[0]}px, ${pos[1]}px, 0)`;
          const now = performance.now();
          if (now - readAt > 60) { readAt = now; probeRead.textContent = text; }
        },
        onLost: noWebgl,
      },
    });
    if (!scan) noWebgl();
  } catch (err) {
    console.warn('Point cloud disabled:', err);
    noWebgl();
  }
}

// Start after the first paint so the text renders before the point cloud is generated.
requestAnimationFrame(() => setTimeout(startScan, 0));
