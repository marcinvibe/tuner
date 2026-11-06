import { stop as stopTuner, onShow as showTuner } from './tuner.js';
import { initLearn, leaveLearn } from './learn/learn.js';

const views = { learn: document.getElementById('view-learn'), tune: document.getElementById('view-tune') };
const tabbar = document.getElementById('tabbar');

function show(name) {
  if (!views[name]) name = 'learn';
  Object.entries(views).forEach(([k, v]) => { v.hidden = k !== name; });
  tabbar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name !== 'tune') stopTuner(); else showTuner();
  if (name !== 'learn') leaveLearn();
  try { localStorage.setItem('view', name); } catch {}
}

tabbar.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) show(b.dataset.view);
});

let start = 'learn';
try { start = localStorage.getItem('view') || 'learn'; } catch {}
show(start);
initLearn();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
