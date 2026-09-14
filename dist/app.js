const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const toast = $('#toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

const filterPanel = $('#filterPanel');
$('#filterButton').addEventListener('click', () => {
  const open = filterPanel.hidden;
  filterPanel.hidden = !open;
  $('#filterButton').setAttribute('aria-expanded', String(open));
});
$('#closeFilter').addEventListener('click', () => {
  filterPanel.hidden = true;
  $('#filterButton').setAttribute('aria-expanded', 'false');
});

$('#saveProfile').addEventListener('click', (event) => {
  event.currentTarget.classList.toggle('active');
  showToast(event.currentTarget.classList.contains('active') ? 'บันทึกโปรไฟล์ณิชาแล้ว' : 'นำออกจากรายการที่บันทึกแล้ว');
});

$('#passButton').addEventListener('click', () => {
  const card = $('#profileCard');
  card.style.opacity = '.35';
  card.style.transform = 'translateX(-10px)';
  setTimeout(() => {
    card.style.opacity = '1';
    card.style.transform = '';
    showToast('ผ่านโปรไฟล์นี้แล้ว — เราจะหาโปรไฟล์ใหม่ให้');
  }, 300);
});

const modal = $('#matchModal');
function openMatch() { modal.hidden = false; document.body.style.overflow = 'hidden'; $('#closeModal').focus(); }
function closeMatch() { modal.hidden = true; document.body.style.overflow = ''; $('#likeButton').focus(); }
$('#likeButton').addEventListener('click', openMatch);
$('#closeModal').addEventListener('click', closeMatch);
$('#keepExploring').addEventListener('click', closeMatch);
modal.addEventListener('click', (event) => { if (event.target === modal) closeMatch(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeMatch(); });

function setSection(section) {
  $$('.nav-item, .mobile-nav-item').forEach((item) => {
    const active = item.dataset.section === section;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  ['explore', 'rooms', 'matches', 'profile'].forEach((view) => {
    $(`#${view}Section`).hidden = view !== section;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-section]').forEach((button) => button.addEventListener('click', () => setSection(button.dataset.section)));
$('#viewMatches').addEventListener('click', () => setSection('matches'));
$('#goMatches').addEventListener('click', () => { closeMatch(); setSection('matches'); });
$('#tuneButton').addEventListener('click', () => { filterPanel.hidden = false; $('#filterButton').setAttribute('aria-expanded', 'true'); filterPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });

$('#createRoom').addEventListener('click', () => showToast('แบบฟอร์มลงประกาศห้องพร้อมเชื่อมต่อกับฐานข้อมูล'));
$$('.room-detail-button, .mini-room').forEach((button) => button.addEventListener('click', () => showToast('เปิดรายละเอียดห้องตัวอย่างแล้ว')));
$$('.copy-contact').forEach((button) => button.addEventListener('click', () => showToast('คัดลอกช่องทางติดต่อแล้ว')));
$('#profileForm').addEventListener('submit', (event) => { event.preventDefault(); showToast('บันทึกโปรไฟล์และไลฟ์สไตล์แล้ว'); });
