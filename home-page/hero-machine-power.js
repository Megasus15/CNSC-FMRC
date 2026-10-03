/* Visitor power controls are local to this page. They pause each machine's
 * existing clock; they never change the Admin's saved scene configuration. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const machines = {
    printer: { name: '3D printer' },
    laser: { name: 'Laser cutter' },
    cnc: { name: 'CNC router' },
  };
  // A separate floor pedestal in the clear foreground to the right. Every
  // face uses the machines' own world projection, including the press axis.
  const project = (x, y, z = 0) => [514 + .86 * x - 1.08 * y, 452 + .4 * x + .28 * y - z];
  const point = p => project(...p).map(v => v.toFixed(2)).join(',');
  const polygon = (points, color, extra = '') => `<polygon points="${points.map(point).join(' ')}" fill="${color}" ${extra}/>`;
  function box(x, y, z, w, d, h, colors) {
    return polygon([[x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]], colors[0]) +
      polygon([[x+w,y,z],[x+w,y+d,z],[x+w,y+d,z+h],[x+w,y,z+h]], colors[2]) +
      polygon([[x,y+d,z],[x+w,y+d,z],[x+w,y+d,z+h],[x,y+d,z+h]], colors[1]);
  }
  const buttonCenter = project(505, 202, 161);
  function createStand() {
    const stand = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stand.setAttribute('viewBox', '0 0 960 760');
    stand.setAttribute('class', 'hero-power-stand');
    stand.setAttribute('aria-hidden', 'true');
    stand.setAttribute('focusable', 'false');
    const casing = ['#99636d', '#663143', '#422132'];
    const metal = ['#e1d7ca', '#a99c9b', '#6c626f'];
    stand.innerHTML = polygon([[459,150,0],[552,150,0],[552,218,0],[459,218,0]], '#201421', 'opacity=".12"') +
      polygon([[466,154,0],[549,154,0],[549,211,0],[466,211,0]], '#201421', 'opacity=".12"') +
      box(468,153,1,74,54,9,casing) + box(475,159,10,60,42,3,metal) +
      box(498,177,13,14,13,131,metal) + box(502,177,13,3,13,131,['#f0e7d8','#d3c3b3','#897b83']) +
      box(469,164,130,72,34,62,casing) +
      polygon([[475,198.3,136],[535,198.3,136],[535,198.3,186],[475,198.3,186]], '#201c28', 'stroke="#c6b3a1" stroke-width="1.5"') +
      '<g class="hero-power-cap">' +
      box(480,198.5,139,50,3.5,44,['var(--power-top)','#174c33','var(--power-side)']) +
      polygon([[480,202,139],[530,202,139],[530,202,183],[480,202,183]], 'var(--power-face)', 'stroke="var(--power-rim)" stroke-width="1.2"') +
      `<g transform="matrix(.86 .4 0 1 ${buttonCenter[0]} ${buttonCenter[1]})"><path d="M0 -11V0 M-8 -7a11 11 0 1 0 16 0" fill="none" stroke="#f4fff8" stroke-width="3" stroke-linecap="round"/></g></g>`;
    return stand;
  }
  function initialize(scene) {
    if (scene.querySelector('.hero-machine-power')) return;
    const states = new Map();
    const stand = createStand();
    const button = document.createElement('button');
    button.className = 'hero-machine-power';
    button.type = 'button';
    button.hidden = true;
    button.style.left = `${buttonCenter[0] / 960 * 100}%`;
    button.style.top = `${buttonCenter[1] / 760 * 100}%`;
    const status = document.createElement('span');
    status.className = 'hero-machine-power-status';
    status.setAttribute('role', 'status');
    scene.append(stand, button, status);
    let type = 'printer', press = null, switchTimer = 0;
    const selected = () => Object.hasOwn(machines, scene.dataset.machine) ? scene.dataset.machine : 'printer';
    function sync() {
      type = selected();
      const machine = machines[type];
      const ready = type === 'printer' ? scene.dataset.mechanism === 'ready' : scene.dataset.machineReady === 'true';
      const allowed = scene.dataset.motion !== 'off' && !reduced.matches;
      const on = allowed && states.get(type) !== false;
      scene.setAttribute('role', 'group');
      scene.setAttribute('aria-label', machine.name + ' interactive illustration');
      const power = on ? 'on' : 'off';
      if (scene.dataset.machinePower !== power) scene.dataset.machinePower = power;
      button.hidden = !ready;
      stand.style.display = ready ? '' : 'none';
      button.disabled = !allowed;
      button.setAttribute('aria-label', machine.name + ' power');
      button.setAttribute('aria-pressed', String(on));
      button.title = !allowed ? 'Animation is off in the motion settings' : `${on ? 'Stop' : 'Start'} ${machine.name.toLowerCase()}`;
    }
    button.addEventListener('click', () => {
      if (button.disabled) return;
      clearTimeout(switchTimer);
      scene.dataset.powerSwitching = 'true';
      switchTimer = setTimeout(() => { delete scene.dataset.powerSwitching; }, 200);
      const on = states.get(type) === false;
      states.set(type, on);
      sync();
      status.textContent = `${machines[type].name} ${on ? 'started. Building resumes.' : 'stopped. Your product stays in place.'}`;
      if (!reduced.matches && typeof button.animate === 'function') {
        press?.cancel();
        // Inward is -Y in world space: +3.78,-0.98 in this projection.
        // Compress into the housing, then let the short spring return settle.
        press = stand.querySelector('.hero-power-cap').animate([
          { transform: 'translate(0, 0)' },
          { transform: 'translate(3.78px, -.98px)', offset: .35 },
          { transform: 'translate(.7px, -.18px)', offset: .8 },
          { transform: 'translate(0, 0)' },
        ], { duration: 160, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    });
    new MutationObserver(sync).observe(scene, {
      attributes: true, attributeFilter: ['data-machine', 'data-motion', 'data-mechanism', 'data-machine-ready'],
    });
    reduced.addEventListener('change', sync);
    sync();
  }
  function init() { document.querySelectorAll('.fmrc-hero-scene').forEach(initialize); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
