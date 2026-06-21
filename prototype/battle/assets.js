// 星舰炉石 · 视觉资产（SVG 生成器，1:1 取自 SC2 comp 战斗界面.dc.html）
const uri = (s) => 'data:image/svg+xml,' + encodeURIComponent(s);

// ── 写实风 + 动画（内嵌渐变光影 + SMIL，直接内联进 DOM 才会动）──
let _svgId = 0; const sid = () => 'r' + (++_svgId);
// 写实战舰（敌/友通用，配色不同）：分层装甲 + 引擎尾焰脉动 + 能量核心呼吸 + 舷灯闪烁
export function warshipSVG(opts = {}) {
  const boss = opts.boss, ally = opts.ally;
  const g = sid();
  const hullTop = ally ? '#3a6478' : boss ? '#4a3a6e' : '#5a6478';
  const hullMid = ally ? '#1e3a4c' : boss ? '#2a2048' : '#2e3647';
  const hullBot = ally ? '#0e1c28' : boss ? '#140e26' : '#161c28';
  const edge = ally ? '#5fe0ee' : boss ? '#b89cf2' : '#7a8499';
  const eng = ally ? '#5fe0ee' : boss ? '#c690ff' : '#ff8a4a';
  const core = ally ? '#bff0ff' : boss ? '#f2dcff' : '#ffe0b0';
  const lite = ally ? '#9fe6ff' : boss ? '#e8c8ff' : '#9fe6ff';
  const dir = ally ? 'scale(-1,1) translate(-560,0)' : '';   // 友舰朝右
  return `<svg viewBox='0 0 560 200' width='100%' height='100%' preserveAspectRatio='xMidYMid meet' xmlns='http://www.w3.org/2000/svg'>
    <defs>
      <linearGradient id='${g}h' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${hullTop}'/><stop offset='.5' stop-color='${hullMid}'/><stop offset='1' stop-color='${hullBot}'/></linearGradient>
      <linearGradient id='${g}hl' x1='0' x2='1'><stop offset='0' stop-color='${edge}'/><stop offset='1' stop-color='${hullMid}'/></linearGradient>
      <radialGradient id='${g}e'><stop offset='0' stop-color='#ffffff'/><stop offset='.3' stop-color='${eng}'/><stop offset='1' stop-color='${eng}' stop-opacity='0'/></radialGradient>
      <radialGradient id='${g}c'><stop offset='0' stop-color='${core}'/><stop offset='1' stop-color='${eng}' stop-opacity='0'/></radialGradient>
    </defs>
    <g transform='${dir}'>
      <ellipse cx='44' cy='100' rx='62' ry='28' fill='url(#${g}e)'><animate attributeName='rx' values='54;70;54' dur='1.6s' repeatCount='indefinite'/><animate attributeName='opacity' values='.65;1;.65' dur='1.6s' repeatCount='indefinite'/></ellipse>
      <path d='M122 58 L470 70 L524 100 L470 130 L122 142 L88 100 Z' fill='url(#${g}h)' stroke='#10161f' stroke-width='2'/>
      <path d='M122 58 L470 70 L470 86 L122 76 Z' fill='url(#${g}hl)' opacity='.55'/>
      <g stroke='#0c1119' stroke-width='1.5' opacity='.55'><path d='M180 62 L180 138 M260 64 L260 140 M340 66 L340 138 M420 70 L420 132'/></g>
      <rect x='84' y='82' width='42' height='14' rx='3' fill='#0a0f17'/><rect x='84' y='104' width='42' height='14' rx='3' fill='#0a0f17'/>
      <rect x='94' y='86' width='14' height='6' fill='${eng}'><animate attributeName='opacity' values='.5;1;.5' dur='1.6s' repeatCount='indefinite'/></rect>
      <rect x='94' y='108' width='14' height='6' fill='${eng}'><animate attributeName='opacity' values='.7;1;.7' dur='1.4s' repeatCount='indefinite'/></rect>
      <path d='M378 70 L420 56 L442 70 L420 92 Z' fill='${hullMid}' stroke='${edge}' stroke-width='1'/>
      <circle cx='300' cy='100' r='22' fill='url(#${g}c)'><animate attributeName='r' values='18;25;18' dur='2.3s' repeatCount='indefinite'/></circle>
      <circle cx='300' cy='100' r='9' fill='#ffffff' opacity='.92'/>
      <circle cx='238' cy='100' r='2.6' fill='${lite}'><animate attributeName='opacity' values='1;.2;1' dur='1.1s' repeatCount='indefinite'/></circle>
      <circle cx='362' cy='100' r='2.6' fill='${lite}'><animate attributeName='opacity' values='.2;1;.2' dur='1.3s' repeatCount='indefinite'/></circle>
      <rect x='198' y='134' width='14' height='10' fill='${hullMid}' stroke='${edge}' stroke-width='1'/><rect x='340' y='134' width='14' height='10' fill='${hullMid}' stroke='${edge}' stroke-width='1'/>
    </g></svg>`;
}
// 写实顶视战舰（出战编成舰桥底图）：金属舰体 + 发光脊柱 + 引擎尾焰 + 舱段节点闪烁
export function shipTopSVG() {
  const g = sid();
  return `<svg viewBox='0 0 1024 300' width='100%' height='100%' preserveAspectRatio='xMidYMid meet' xmlns='http://www.w3.org/2000/svg'>
    <defs>
      <linearGradient id='${g}h' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#14283a'/><stop offset='.5' stop-color='#2f5878'/><stop offset='1' stop-color='#12243a'/></linearGradient>
      <radialGradient id='${g}e'><stop offset='0' stop-color='#cff4ff'/><stop offset='.4' stop-color='#5fd2eb'/><stop offset='1' stop-color='#5fd2eb' stop-opacity='0'/></radialGradient>
      <linearGradient id='${g}s' x1='0' x2='1'><stop offset='0' stop-color='#5fe0ee' stop-opacity='0'/><stop offset='.5' stop-color='#bff4ff'/><stop offset='1' stop-color='#5fe0ee' stop-opacity='0'/></linearGradient>
    </defs>
    <ellipse cx='72' cy='150' rx='92' ry='42' fill='url(#${g}e)'><animate attributeName='opacity' values='.55;1;.55' dur='2.1s' repeatCount='indefinite'/><animate attributeName='rx' values='80;100;80' dur='2.1s' repeatCount='indefinite'/></ellipse>
    <path d='M260 96 L380 68 L424 96 Z' fill='#1a3346' stroke='#3f7d96' stroke-width='1'/><path d='M260 204 L380 232 L424 204 Z' fill='#1a3346' stroke='#3f7d96' stroke-width='1'/>
    <path d='M122 150 L300 94 L762 120 L932 150 L762 180 L300 206 Z' fill='url(#${g}h)' stroke='#5fd2eb' stroke-width='2'/>
    <path d='M300 94 L762 120 L932 150 L762 150 L300 150 Z' fill='#2a4a64' opacity='.45'/>
    <rect x='150' y='147' width='742' height='6' rx='3' fill='url(#${g}s)'><animate attributeName='opacity' values='.5;1;.5' dur='2.4s' repeatCount='indefinite'/></rect>
    <g stroke='#0c1c2a' stroke-width='1.5' opacity='.5'><path d='M340 108 L340 192 M480 114 L480 186 M620 118 L620 182 M762 124 L762 176'/></g>
    <g fill='#5fe0ee'><circle cx='430' cy='150' r='3'><animate attributeName='opacity' values='1;.3;1' dur='1.6s' repeatCount='indefinite'/></circle><circle cx='560' cy='150' r='3'><animate attributeName='opacity' values='.3;1;.3' dur='1.9s' repeatCount='indefinite'/></circle><circle cx='690' cy='150' r='3'><animate attributeName='opacity' values='1;.3;1' dur='2.1s' repeatCount='indefinite'/></circle></g>
    <circle cx='908' cy='150' r='4' fill='#d6f6ff'><animate attributeName='opacity' values='.5;1;.5' dur='1.3s' repeatCount='indefinite'/></circle>
  </svg>`;
}
// 写实行星：大气辉光 + 表面渐变 + 自转云带 + 晨昏线阴影
export function planetSVG(opts = {}) {
  const g = sid();
  const SCHEMES = {
    default: [['#ffd9a8', '#e07a4a', '#7a2f3a', '#2a1230'], 'rgba(255,150,90,.2)'],
    ice: [['#cfeaff', '#5a93c8', '#214a78', '#0c1a30'], 'rgba(120,180,255,.22)'],
    void: [['#e0c8ff', '#9a6fe0', '#4a2f78', '#160e2a'], 'rgba(170,110,255,.22)'],
    earth: [['#bfeaff', '#3f93c8', '#1d6a5a', '#0a1c28'], 'rgba(90,180,220,.24)'],
    mars: [['#ffcaa0', '#d8693a', '#7a2f25', '#220e0c'], 'rgba(230,110,70,.24)'],
    moon: [['#e2e7ee', '#9aa4b0', '#48505e', '#12161e'], 'rgba(170,190,210,.18)'],
    gas: [['#ffe6bf', '#e0975a', '#9a5638', '#341c16'], 'rgba(240,160,90,.22)'],
  };
  const [a, glow] = SCHEMES[opts.scheme] || SCHEMES.default;
  return `<svg viewBox='0 0 200 200' width='100%' height='100%' xmlns='http://www.w3.org/2000/svg'>
    <defs><radialGradient id='${g}p' cx='35%' cy='30%'><stop offset='0' stop-color='${a[0]}'/><stop offset='.5' stop-color='${a[1]}'/><stop offset='.85' stop-color='${a[2]}'/><stop offset='1' stop-color='${a[3]}'/></radialGradient><clipPath id='${g}c'><circle cx='100' cy='100' r='84'/></clipPath></defs>
    <circle cx='100' cy='100' r='94' fill='${glow}'/>
    <circle cx='100' cy='100' r='84' fill='url(#${g}p)'/>
    <g clip-path='url(#${g}c)' opacity='.38'><g><ellipse cx='100' cy='78' rx='130' ry='13' fill='#fff' opacity='.22'/><ellipse cx='100' cy='112' rx='130' ry='9' fill='#fff' opacity='.16'/><ellipse cx='100' cy='132' rx='130' ry='7' fill='#fff' opacity='.12'/><animateTransform attributeName='transform' type='translate' values='-44 0;44 0;-44 0' dur='44s' repeatCount='indefinite'/></g></g>
    <path d='M100 16 A84 84 0 0 1 100 184 A126 126 0 0 0 100 16 Z' fill='#000' opacity='.42'/>
    <circle cx='100' cy='100' r='84' fill='none' stroke='${a[0]}' stroke-opacity='.25' stroke-width='1'/></svg>`;
}

export function starfield() {
  let stars = '';
  for (let i = 0; i < 140; i++) { const x = (Math.random() * 1920) | 0, y = (Math.random() * 1080) | 0, r = (Math.random() * 1.4 + 0.3).toFixed(1), o = (Math.random() * 0.7 + 0.2).toFixed(2); stars += `<circle cx='${x}' cy='${y}' r='${r}' fill='#cfe6ff' opacity='${o}'/>`; }
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080'>${stars}</svg>`);
}

export const portrait = (p) => uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 220 260'><ellipse cx='110' cy='84' rx='98' ry='106' fill='${p.accent}' opacity='.22'/><ellipse cx='110' cy='68' rx='60' ry='66' fill='${p.accent}' opacity='.2'/><path d='M22 260 Q34 182 80 166 L140 166 Q186 182 198 260 Z' fill='${p.uniform}'/><path d='M22 260 Q34 182 80 166 L98 166 L72 260 Z' fill='${p.uniformL}'/><path d='M90 172 L130 172 L120 206 L100 206 Z' fill='${p.accent}' opacity='.5'/><path d='M78 168 L110 198 L142 168' fill='none' stroke='${p.accent}' stroke-width='4' opacity='.95'/><rect x='99' y='148' width='22' height='34' fill='${p.skinD}'/><path d='M110 50 Q152 50 152 100 Q152 150 110 164 Q68 150 68 100 Q68 50 110 50 Z' fill='${p.skin}'/><path d='M110 52 Q142 54 148 94 Q140 70 110 66 Q84 68 76 90 Q82 56 110 52 Z' fill='${p.skinL}' opacity='.92'/><path d='M82 122 Q96 158 110 162 Q124 158 138 122 Q120 150 110 150 Q100 150 82 122 Z' fill='${p.skinD}' opacity='.45'/><path d='M64 102 Q56 44 110 38 Q164 44 156 102 Q150 74 128 66 Q120 86 110 84 Q90 84 84 68 Q68 78 64 102 Z' fill='${p.hair}'/><path d='M128 66 Q150 72 156 102 Q158 80 150 60 Q140 62 128 66 Z' fill='${p.hair2}'/><path d='M150 60 Q160 84 150 104 Q160 80 150 60 Z' fill='#ffffff' opacity='.32'/><path d='M84 113 q9 -7 18 0' fill='none' stroke='${p.eye}' stroke-width='4.5' stroke-linecap='round'/><path d='M118 113 q9 -7 18 0' fill='none' stroke='${p.eye}' stroke-width='4.5' stroke-linecap='round'/><rect x='80' y='101' width='60' height='2.5' fill='${p.accent}' opacity='.7'/></svg>`);

export const crack = uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 260'><path d='M70 0 L96 70 L74 110 L110 150 L86 200 L120 260' fill='none' stroke='#ff5a3c' stroke-width='2.4' opacity='.85'/><path d='M96 70 L130 90 M74 110 L40 120 M110 150 L150 140 M86 200 L52 220' fill='none' stroke='#ff8a5a' stroke-width='1.6' opacity='.7'/><path d='M150 10 L130 60 L160 100 L138 160' fill='none' stroke='#ff5a3c' stroke-width='1.8' opacity='.6'/></svg>`);

export const drone = (boss) => uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><line x1='28' y1='80' x2='6' y2='80' stroke='#52647a' stroke-width='7'/><line x1='132' y1='80' x2='154' y2='80' stroke='#52647a' stroke-width='7'/><polygon points='80,16 134,48 134,112 80,144 26,112 26,48' fill='#394d60' stroke='#7ed0e0' stroke-width='3'/><polygon points='80,16 134,48 80,72 26,48' fill='#4c6478'/><polygon points='80,42 112,58 112,102 80,120 48,102 48,58' fill='#0c1822'/><circle cx='80' cy='80' r='15' fill='${boss ? '#ff6a4a' : '#ff8a4a'}'/><circle cx='80' cy='80' r='7' fill='#ffe0b0'/><rect x='70' y='4' width='20' height='8' fill='#52647a'/></svg>`);

export const friendlyDrone = uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'><polygon points='80,18 130,50 130,110 80,142 30,110 30,50' fill='#2f4a5e' stroke='#5fe0ee' stroke-width='3'/><polygon points='80,18 130,50 80,72 30,50' fill='#3f6478'/><polygon points='80,44 108,60 108,100 80,116 52,100 52,60' fill='#0a1620'/><circle cx='80' cy='80' r='13' fill='#5fe0ee'/><circle cx='80' cy='80' r='6' fill='#d6f6ff'/></svg>`);

export const enemyShip = (boss) => {
  const core = boss ? '#c690ff' : '#ff8a5a', coreL = boss ? '#f2dcff' : '#ffe6cc', hull = boss ? '#3a2f58' : '#3a2832', hullL = boss ? '#544879' : '#57414d', edge = boss ? '#b89cf2' : '#ffb088';
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 560 260'><ellipse cx='280' cy='150' rx='250' ry='92' fill='${core}' opacity='.22'/><ellipse cx='280' cy='150' rx='150' ry='64' fill='${core}' opacity='.25'/><path d='M44 68 L152 96 L152 152 L60 174 Z' fill='${hull}' stroke='${edge}' stroke-width='2.5'/><path d='M516 68 L408 96 L408 152 L500 174 Z' fill='${hull}' stroke='${edge}' stroke-width='2.5'/><path d='M152 68 L408 68 L470 150 L356 214 L204 214 L90 150 Z' fill='${hull}' stroke='${edge}' stroke-width='3.5'/><path d='M152 68 L408 68 L408 96 L152 96 Z' fill='${hullL}'/><path d='M152 96 L200 96 L152 150 L90 150 Z' fill='${hullL}' opacity='.65'/><path d='M408 96 L470 150 L408 150 L360 96 Z' fill='${hullL}' opacity='.65'/><path d='M182 96 L378 96 M172 124 L388 124' stroke='${edge}' stroke-width='2' opacity='.5'/><rect x='198' y='198' width='32' height='44' rx='4' fill='${hull}' stroke='${edge}' stroke-width='2'/><rect x='330' y='198' width='32' height='44' rx='4' fill='${hull}' stroke='${edge}' stroke-width='2'/><g fill='${coreL}'><circle cx='240' cy='110' r='3'/><circle cx='280' cy='110' r='3'/><circle cx='320' cy='110' r='3'/></g><polygon points='280,114 318,150 280,186 242,150' fill='${coreL}'/><circle cx='280' cy='150' r='32' fill='${core}'/><circle cx='280' cy='150' r='14' fill='#ffffff'/></svg>`);
};

export const traitIcon = (type, c) => {
  const m = {
    gear: `<g fill='none' stroke='${c}' stroke-width='4'><circle cx='24' cy='24' r='7.5'/><path d='M24 7v6M24 35v6M7 24h6M35 24h6M12 12l4 4M32 32l4 4M36 12l-4 4M16 32l-4 4'/></g>`,
    shield: `<path d='M24 6l14 5v10c0 11-8 17-14 21-6-4-14-10-14-21V11z' fill='none' stroke='${c}' stroke-width='4'/>`,
    cross: `<path d='M20 8h8v12h12v8H28v12h-8V28H8v-8h12z' fill='${c}'/>`,
    bolt: `<path d='M27 4L10 28h11l-4 16 21-27H26z' fill='${c}'/>`,
  };
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>${m[type] || m.gear}</svg>`);
};

export const intentIcon = (type, c) => {
  const m = {
    attack: `<g stroke='${c}' stroke-width='4' fill='none' stroke-linecap='round'><path d='M10 38L38 10M30 10h8v8'/><path d='M38 38L10 10M18 10h-8v8'/></g>`,
    summon: `<g fill='none' stroke='${c}' stroke-width='3.5'><polygon points='24,8 38,17 38,33 24,42 10,33 10,17'/><path d='M24 18v12M18 24h12' stroke-linecap='round'/></g>`,
    charge: `<path d='M27 4L10 28h11l-4 16 21-27H26z' fill='${c}'/>`,
  };
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>${m[type] || m.attack}</svg>`);
};

export const cardArt = (cat, c) => {
  const m = {
    attack: `<g stroke='${c}' stroke-width='5' fill='none'><circle cx='60' cy='52' r='26'/><path d='M60 14v76M22 52h76' stroke-width='3'/><circle cx='60' cy='52' r='8' fill='${c}'/></g>`,
    defense: `<path d='M60 16l34 12v22c0 26-20 40-34 50-14-10-34-24-34-50V28z' fill='none' stroke='${c}' stroke-width='5'/><path d='M60 34v44' stroke='${c}' stroke-width='3'/>`,
    maintenance: `<g stroke='${c}' stroke-width='6' fill='none' stroke-linecap='round'><path d='M44 30a16 16 0 1 0 22 22L86 72'/><path d='M70 36l12-12 8 8-12 12z'/></g>`,
    tactics: `<g fill='none' stroke='${c}' stroke-width='4'><circle cx='60' cy='52' r='30'/><circle cx='60' cy='52' r='16'/><path d='M60 22v60M30 52h60' stroke-width='2'/><circle cx='60' cy='52' r='5' fill='${c}'/></g>`,
  };
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 104'>${m[cat] || m.attack}</svg>`);
};

// 对话选项标签图标（好感/能力/协同）
export const tagIcon = (type, c) => {
  const m = {
    heart: `<path d='M24 40C10 30 6 20 12 13c4-5 10-3 12 2 2-5 8-7 12-2 6 7 2 17-12 27z' fill='${c}'/>`,
    chip: `<g fill='none' stroke='${c}' stroke-width='3.4'><rect x='14' y='14' width='20' height='20' rx='2'/><path d='M20 8v6M28 8v6M20 34v6M28 34v6M8 20h6M8 28h6M34 20h6M34 28h6' stroke-linecap='round'/></g>`,
    link: `<g fill='none' stroke='${c}' stroke-width='3.6' stroke-linecap='round'><path d='M20 28l8-8'/><path d='M26 14l3-3a7 7 0 0 1 10 10l-6 6a7 7 0 0 1-10 0'/><path d='M22 34l-3 3a7 7 0 0 1-10-10l6-6a7 7 0 0 1 10 0'/></g>`,
  };
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>${m[type] || m.heart}</svg>`);
};

// 对话立绘兜底（无真人照片时）：表情驱动 SVG（取自 comp 对话界面）
export const dialoguePortrait = (mood) => {
  const skin = '#f6cda2', skinL = '#ffe8c8', skinD = '#d49a6e', hair = '#ff8a4a', hairD = '#cf551c', hairL = '#ffc089',
    jacket = '#22384e', jacketL = '#34546f', collar = '#16273a', cyan = '#5fe0ee', iris = '#356a78', brow = '#a85528', lip = '#d97a64', under = '#bfe0db';
  const blush = (mood === 'blush' || mood === 'bright') ? 0.42 : 0;
  const mouth = (mood === 'smile') ? 'M250 360 q30 20 58 -2' : (mood === 'bright') ? 'M246 358 q32 26 62 -4' : (mood === 'blush') ? 'M256 364 q24 13 48 -1' : 'M254 366 q26 11 52 -1';
  const eyeH = (mood === 'bright') ? 6 : 4;
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 560 840'><ellipse cx='282' cy='320' rx='250' ry='320' fill='${hair}' opacity='.1'/><ellipse cx='282' cy='250' rx='150' ry='170' fill='${cyan}' opacity='.06'/><path d='M150 360 Q116 168 282 150 Q448 168 414 360 L426 540 Q360 486 282 486 Q204 486 138 540 Z' fill='${hairD}'/><path d='M70 840 L70 600 Q92 498 184 470 L378 470 Q470 498 492 600 L492 840 Z' fill='${jacket}'/><path d='M70 840 L70 600 Q92 498 184 470 L214 470 L150 840 Z' fill='${jacketL}' opacity='.55'/><path d='M205 472 L282 566 L359 472 L341 472 L282 538 L222 472 Z' fill='${collar}'/><path d='M236 472 L282 548 L328 472 Z' fill='${under}' opacity='.85'/><path d='M250 402 L314 402 L316 474 L248 474 Z' fill='${skinD}'/><path d='M258 406 L304 406 L302 466 L260 466 Z' fill='${skin}'/><path d='M180 272 Q180 162 282 160 Q384 162 384 272 Q384 384 322 420 Q282 438 240 420 Q180 384 180 272 Z' fill='${skin}'/><path d='M210 300 Q230 364 272 386 Q236 348 224 300 Q218 290 210 300 Z' fill='${skinL}' opacity='.6'/><ellipse cx='234' cy='342' rx='20' ry='13' fill='${lip}' opacity='${blush}'/><ellipse cx='332' cy='338' rx='18' ry='12' fill='${lip}' opacity='${blush}'/><path d='M218 266 q24 -11 48 -3' fill='none' stroke='${brow}' stroke-width='6' stroke-linecap='round'/><path d='M300 260 q22 -9 42 0' fill='none' stroke='${brow}' stroke-width='6' stroke-linecap='round'/><path d='M222 288 q24 -13 50 -2 q-7 17 -30 17 q-17 0 -20 -15 Z' fill='#fdf7ee'/><path d='M304 284 q22 -11 42 -2 q-6 15 -26 15 q-15 0 -16 -13 Z' fill='#fdf7ee'/><circle cx='250' cy='292' r='11' fill='${iris}'/><circle cx='250' cy='292' r='5.5' fill='#16242b'/><circle cx='246' cy='288' r='3' fill='#fff'/><circle cx='326' cy='289' r='10' fill='${iris}'/><circle cx='326' cy='289' r='5' fill='#16242b'/><circle cx='322' cy='285' r='2.6' fill='#fff'/><path d='M222 288 q24 -13 50 -2' fill='none' stroke='#3a2a22' stroke-width='${eyeH}' stroke-linecap='round'/><path d='M304 284 q22 -11 42 -2' fill='none' stroke='#3a2a22' stroke-width='${eyeH}' stroke-linecap='round'/><path d='${mouth}' fill='none' stroke='${lip}' stroke-width='6' stroke-linecap='round'/><path d='M180 272 Q174 150 282 150 Q400 150 388 286 Q374 212 320 190 Q300 234 260 226 Q300 212 298 188 Q248 198 226 236 Q210 256 206 214 Q194 246 192 286 Q186 254 180 272 Z' fill='${hair}'/><path d='M300 190 Q352 206 384 282 Q380 220 350 186 Q328 184 300 190 Z' fill='${hairL}' opacity='.55'/><path d='M188 274 Q172 384 200 472 Q184 384 200 286 Z' fill='${hair}'/></svg>`);
};

// 卡牌类别配色（攻/防/维/战术）
export const CAT = {
  attack: { label: '攻击', color: '#ff4d4d', glow: 'rgba(255,77,77,.55)' },
  defense: { label: '防御', color: '#4d9fff', glow: 'rgba(77,159,255,.55)' },
  maintenance: { label: '维护', color: '#3ff0a0', glow: 'rgba(63,240,160,.5)' },
  tactics: { label: '战术', color: '#ffcc4d', glow: 'rgba(255,204,77,.5)' },
};

// 星图节点图标（战斗/精英/Boss/事件/补给）
export const nodeIcon = (t, c) => {
  const m = {
    combat: `<g stroke='${c}' stroke-width='3.4' fill='none' stroke-linecap='round'><path d='M12 36L34 14M28 14h8v8'/><path d='M36 36L14 14M20 14h-8v8'/></g>`,
    elite: `<path d='M24 6l5 13 14 1-11 9 4 14-12-8-12 8 4-14-11-9 14-1z' fill='${c}'/>`,
    boss: `<g fill='none' stroke='${c}' stroke-width='3'><circle cx='24' cy='24' r='12'/><path d='M24 12v24M12 24h24M15 15l18 18M33 15L15 33'/></g>`,
    event: `<g fill='none' stroke='${c}' stroke-width='3.6' stroke-linecap='round'><path d='M18 19a6 6 0 1 1 9 5c-2 1.5-3 2.5-3 5'/><circle cx='24' cy='35' r='1.6' fill='${c}'/></g>`,
    supply: `<g fill='none' stroke='${c}' stroke-width='3.6' stroke-linecap='round'><path d='M24 14v20M14 24h20'/></g>`,
  };
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'>${m[t] || m.combat}</svg>`);
};
export const enemyThumb = (c) => uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'><ellipse cx='80' cy='60' rx='70' ry='34' fill='${c}' opacity='.16'/><path d='M20 40 L60 50 L60 70 L26 80 Z' fill='#2a2436' stroke='${c}' stroke-width='1.6'/><path d='M140 40 L100 50 L100 70 L134 80 Z' fill='#2a2436' stroke='${c}' stroke-width='1.6'/><path d='M60 38 L100 38 L116 60 L92 84 L68 84 L44 60 Z' fill='#2a2436' stroke='${c}' stroke-width='2.4'/><polygon points='80,46 96,60 80,74 64,60' fill='${c}'/><circle cx='80' cy='60' r='8' fill='#fff'/></svg>`);
export const flagSvg = uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 90'><ellipse cx='60' cy='46' rx='52' ry='24' fill='#5fe0ee' opacity='.18'/><path d='M18 36 L66 28 L96 46 L66 64 L18 56 Z' fill='#13344a' stroke='#5fe0ee' stroke-width='2.2'/><path d='M18 36 L66 28 L70 46 L18 46 Z' fill='#1e5168' opacity='.7'/><polygon points='90,40 104,46 90,52' fill='#5fe0ee'/><circle cx='60' cy='46' r='6' fill='#d6f6ff'/><circle cx='60' cy='46' r='12' fill='none' stroke='#5fe0ee' stroke-width='1.4' opacity='.6'/></svg>`);
export const FAC = { free: { name: '自由舰队', color: '#5fe0ee' }, raider: { name: '掠夺者', color: '#ff8a4a' }, void: { name: '虚空教团', color: '#c07bff' }, neutral: { name: '中立', color: '#8fa6b6' } };
export const TYPE_META = { combat: '战斗', elite: '精英', boss: 'BOSS', event: '事件', supply: '补给' };

// 舰桥结构示意图（出战编成中央，取自 comp）
export const shipSchematic = (() => {
  const e = '#5fd2eb', e2 = 'rgba(95,210,235,.4)', hull = '#16273a', hullL = '#22384e';
  return uri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 300'><path d='M60 150 L150 110 L820 96 L980 150 L820 204 L150 190 Z' fill='${hull}' stroke='${e}' stroke-width='2'/><path d='M150 110 L820 96 L900 124 L150 138 Z' fill='${hullL}' opacity='.6'/><path d='M60 150 L150 110 L150 190 Z' fill='${hull}' stroke='${e}' stroke-width='2'/><g stroke='${e2}' stroke-width='1.5' fill='none'><path d='M150 138 L900 124 M150 162 L900 176'/></g><g stroke='${e2}' stroke-width='1' fill='none' opacity='.7'><path d='M210 138 L210 162 M338 136 L338 164 M466 134 L466 166 M594 132 L594 168 M722 130 L722 170'/></g><circle cx='890' cy='150' r='10' fill='none' stroke='${e}' stroke-width='2'/><circle cx='890' cy='150' r='3' fill='${e}'/><path d='M70 130 L120 150 L70 170' fill='none' stroke='${e}' stroke-width='2' opacity='.6'/><g fill='${e}' opacity='.5'><circle cx='250' cy='150' r='2.5'/><circle cx='450' cy='150' r='2.5'/><circle cx='650' cy='150' r='2.5'/><circle cx='820' cy='150' r='2.5'/></g></svg>`);
})();

// 船员立绘调色板（轮换分派）
export const PALETTES = [
  { skin: '#f3c9a0', skinL: '#ffe6c8', skinD: '#cf9c6e', hair: '#ff7a3c', hair2: '#c44e1f', uniform: '#2e4b6b', uniformL: '#3f6890', accent: '#4fd6e6', eye: '#23303f' },
  { skin: '#e8b58a', skinL: '#ffd8b0', skinD: '#bd8a60', hair: '#1b2a44', hair2: '#0d1830', uniform: '#244e6b', uniformL: '#356a8e', accent: '#4d9fff', eye: '#1a2433' },
  { skin: '#f6d2b0', skinL: '#ffe9d0', skinD: '#cba07a', hair: '#8a6df0', hair2: '#5b3fd0', uniform: '#2b5d52', uniformL: '#3d7e6f', accent: '#3ff0a0', eye: '#26323f' },
  { skin: '#d9a878', skinL: '#f0c79a', skinD: '#a87a4e', hair: '#cfd6e0', hair2: '#9aa3b0', uniform: '#5a3b3b', uniformL: '#7a5252', accent: '#ff8a3c', eye: '#1c222b' },
];
