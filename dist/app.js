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
  ['explore', 'swipe', 'rooms', 'matches', 'profile'].forEach((view) => {
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

const swipeProfiles = [
  {
    name: 'ณิชา',
    age: 21,
    faculty: 'คณะสถาปัตยกรรมศาสตร์ · ปี 3',
    image: './assets/nicha-profile.png',
    score: 92,
    bio: 'มองหาเพื่อนร่วมห้องที่คุยกันตรงไปตรงมา รักษาพื้นที่ส่วนกลาง และชอบมุมห้องสบาย ๆ เหมือนกัน',
    traits: ['☾ นอน 23:30 น.', '✦ ไม่สูบบุหรี่', '♡ รักสัตว์'],
    metrics: { sleep: 96, clean: 92, budget: 88 },
  },
  {
    name: 'กานต์',
    age: 22,
    faculty: 'คณะวิศวกรรมศาสตร์ · ปี 4',
    image: './assets/kant-profile.png',
    score: 88,
    bio: 'เป็นคนสบาย ๆ แต่มีระเบียบ ชอบออกกำลังกายหลังเลิกเรียน และแบ่งงานบ้านกันแบบชัดเจน',
    traits: ['☾ นอน 00:30 น.', '✦ เป็นระเบียบ', '⌁ เล่นกีฬา'],
    metrics: { sleep: 89, clean: 90, budget: 85 },
  },
  {
    name: 'มินตรา',
    age: 20,
    faculty: 'คณะนิเทศศาสตร์ · ปี 2',
    image: './assets/mintra-profile.png',
    score: 85,
    bio: 'ชอบทำอาหารง่าย ๆ และดูหนังช่วงวันหยุด อยากได้รูมเมตที่เป็นมิตร เคารพเวลาพัก และช่วยกันดูแลห้อง',
    traits: ['☾ นอน 23:00 น.', '✦ ชอบทำอาหาร', '♡ รักแมว'],
    metrics: { sleep: 94, clean: 84, budget: 82 },
  },
];

const swipeCard = $('#swipeCard');
const swipeEmpty = $('#swipeEmpty');
const passStamp = $('#passStamp');
const likeStamp = $('#likeStamp');
let swipeIndex = 0;
let swipeHistory = [];
let swipeStats = { pass: 0, like: 0 };
let activePointerId = null;
let pointerStartX = 0;
let pointerCurrentX = 0;
let swipeAnimating = false;
let swipeAnimationTimer;
let snapBackTimer;

function resetCardPosition() {
  clearTimeout(snapBackTimer);
  swipeCard.classList.remove('dragging');
  swipeCard.style.transition = '';
  swipeCard.style.transform = '';
  swipeCard.style.opacity = '';
  passStamp.style.opacity = '';
  likeStamp.style.opacity = '';
}

function renderSwipeProfile() {
  const profile = swipeProfiles[swipeIndex];
  $('#passCount').textContent = swipeStats.pass;
  $('#likeCount').textContent = swipeStats.like;
  $('#cardsLeft').textContent = profile ? swipeProfiles.length - swipeIndex : 0;
  $('#swipeUndo').disabled = swipeHistory.length === 0;
  $('#swipePass').disabled = !profile;
  $('#swipeLike').disabled = !profile;
  swipeCard.hidden = !profile;
  swipeEmpty.hidden = Boolean(profile);
  resetCardPosition();

  if (!profile) return;

  $('#swipeImage').src = profile.image;
  $('#swipeImage').alt = `ภาพโปรไฟล์ของ${profile.name}`;
  $('#swipeName').textContent = profile.name;
  $('#swipeAge').textContent = `${profile.age} ปี`;
  $('#swipeFaculty').textContent = profile.faculty;
  $('#swipeScore').textContent = `${profile.score}%`;
  $('#swipeBio').textContent = profile.bio;
  $('#swipeTraits').innerHTML = profile.traits.map((trait) => `<span>${trait}</span>`).join('');

  ['sleep', 'clean', 'budget'].forEach((metric) => {
    const value = profile.metrics[metric];
    $(`#${metric}Match`).textContent = `${value}%`;
    $(`#${metric}Bar`).style.width = `${value}%`;
  });
}

function completeSwipe(decision) {
  const profile = swipeProfiles[swipeIndex];
  if (!profile || swipeAnimating || activePointerId !== null) return;

  swipeAnimating = true;
  const liked = decision === 'like';
  swipeHistory.push({ index: swipeIndex, decision });
  swipeStats[decision] += 1;
  $('#swipePass').disabled = true;
  $('#swipeLike').disabled = true;
  $('#swipeUndo').disabled = true;
  swipeCard.style.transition = 'transform 280ms ease, opacity 280ms ease';
  swipeCard.style.transform = `translateX(${liked ? 130 : -130}%) rotate(${liked ? 12 : -12}deg)`;
  swipeCard.style.opacity = '0';
  (liked ? likeStamp : passStamp).style.opacity = '1';

  swipeAnimationTimer = window.setTimeout(() => {
    swipeIndex += 1;
    swipeAnimating = false;
    renderSwipeProfile();
    showToast(liked ? `เลือก ${profile.name} ไว้แล้ว — พร้อมเริ่มทำความรู้จัก` : `ผ่าน ${profile.name} แล้ว`);
  }, 280);
}

function undoSwipe() {
  if (swipeAnimating || activePointerId !== null) return;
  const previous = swipeHistory.pop();
  if (!previous) return;
  swipeStats[previous.decision] = Math.max(0, swipeStats[previous.decision] - 1);
  swipeIndex = previous.index;
  renderSwipeProfile();
  showToast('ย้อนกลับมาให้เลือกอีกครั้งแล้ว');
}

function resetSwipe() {
  clearTimeout(swipeAnimationTimer);
  swipeIndex = 0;
  swipeHistory = [];
  swipeStats = { pass: 0, like: 0 };
  activePointerId = null;
  swipeAnimating = false;
  renderSwipeProfile();
  showToast('เริ่มดูโปรไฟล์ใหม่ตั้งแต่คนแรก');
}

function previewDrag(distance) {
  const strength = Math.min(Math.abs(distance) / 110, 1);
  swipeCard.style.transform = `translateX(${distance}px) rotate(${distance * 0.035}deg)`;
  likeStamp.style.opacity = distance > 0 ? strength : 0;
  passStamp.style.opacity = distance < 0 ? strength : 0;
}

swipeCard.addEventListener('pointerdown', (event) => {
  if (swipeAnimating || activePointerId !== null || swipeCard.hidden) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  activePointerId = event.pointerId;
  pointerStartX = event.clientX;
  pointerCurrentX = event.clientX;
  clearTimeout(snapBackTimer);
  swipeCard.style.transition = '';
  swipeCard.classList.add('dragging');
  try {
    swipeCard.setPointerCapture(event.pointerId);
  } catch {
    activePointerId = null;
    swipeCard.classList.remove('dragging');
  }
});

swipeCard.addEventListener('pointermove', (event) => {
  if (event.pointerId !== activePointerId) return;
  pointerCurrentX = event.clientX;
  previewDrag(pointerCurrentX - pointerStartX);
});

function snapCardBack() {
  swipeCard.classList.remove('dragging');
  swipeCard.style.transition = 'transform 220ms ease';
  swipeCard.style.transform = '';
  passStamp.style.opacity = '';
  likeStamp.style.opacity = '';
  clearTimeout(snapBackTimer);
  snapBackTimer = window.setTimeout(() => { swipeCard.style.transition = ''; }, 220);
}

function releaseActivePointer(pointerId) {
  if (swipeCard.hasPointerCapture(pointerId)) {
    try { swipeCard.releasePointerCapture(pointerId); } catch { /* capture already ended */ }
  }
}

function finishPointerSwipe(event) {
  if (event.pointerId !== activePointerId) return;
  pointerCurrentX = event.clientX;
  const distance = pointerCurrentX - pointerStartX;
  activePointerId = null;
  releaseActivePointer(event.pointerId);
  swipeCard.classList.remove('dragging');
  if (Math.abs(distance) >= 100) completeSwipe(distance > 0 ? 'like' : 'pass');
  else snapCardBack();
}

function cancelPointerSwipe(event) {
  if (event && event.pointerId !== activePointerId) return;
  const pointerId = activePointerId;
  activePointerId = null;
  if (pointerId !== null) releaseActivePointer(pointerId);
  snapCardBack();
}

swipeCard.addEventListener('pointerup', finishPointerSwipe);
swipeCard.addEventListener('pointercancel', cancelPointerSwipe);
swipeCard.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === activePointerId) cancelPointerSwipe(event);
});
window.addEventListener('blur', () => {
  if (activePointerId !== null) cancelPointerSwipe();
});
swipeCard.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    completeSwipe('pass');
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    completeSwipe('like');
  }
});

$('#swipePass').addEventListener('click', () => completeSwipe('pass'));
$('#swipeLike').addEventListener('click', () => completeSwipe('like'));
$('#swipeUndo').addEventListener('click', undoSwipe);
$('#resetSwipe').addEventListener('click', resetSwipe);

renderSwipeProfile();
