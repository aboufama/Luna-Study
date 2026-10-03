import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { createMosaicField } from './mosaic-field.mjs';
import { compileMosaicScene } from './mosaic-stage.mjs';
import { stoneAtlas } from './VoiceCanvas.jsx';
import './mosaic-presence-preview.css';

const tiles = createMosaicField().tiles.map((tile, index) => ({ ...tile, id: `stone-${index}` }));
const modes = ['Corner fold', 'Living frame'];
const descriptions = [
  'A small curl of stone grows from the frame. The tutor stays part of the composition.',
  'The tutor becomes the frame. A quiet change in the stone marks its presence.',
];

function stage(mode, fixture, width, height) {
  const boardWidth = Math.min(fixture === 'Diagram' ? 960 : 760, width - 70);
  const boardHeight = Math.max(fixture === 'Diagram' ? 588 : 400, 980 - boardWidth);
  const board = { x: (width - boardWidth) / 2, y: (height - boardHeight) / 2 - 12, width: boardWidth, height: boardHeight };
  const foldCount = mode === 0 ? 54 : 0;
  const courses = Math.max(2, Math.ceil((tiles.length - foldCount) * 7.3 / (2 * (board.width + board.height) - 50)));
  const frameIds = tiles.slice(foldCount).map(tile => tile.id);
  const groups = [{ id: 'board', tileIds: frameIds, shape: { type: 'frame', ...board, courses, pitch: 7.3, cornerRadius: 24 } }];
  const presence = { x: board.x + board.width - 12, y: board.y + board.height - 12 };
  if (foldCount) {
    let offset = 0;
    const poses = [17, 18, 19].flatMap((count, lane) => Array.from({ length: count }, (_, rank) => {
      const angle = rank / (count - 1) * Math.PI / 2;
      const radius = 77 + lane * 7.3;
      const tile = tiles[offset++];
      return { x: board.x + board.width - 72 + Math.cos(angle) * radius,
        y: board.y + board.height - 72 + Math.sin(angle) * radius,
        rotation: angle + Math.PI / 2 - tile.angle };
    }));
    groups.push({ id: 'fold', tileIds: tiles.slice(0, foldCount).map(tile => tile.id), shape: { type: 'poses', poses } });
  }
  return { ...compileMosaicScene(tiles, { version: 1, groups }), board, presence, boardCount: tiles.length - foldCount, tutorCount: foldCount, courses };
}

function Formula({ children }) {
  return <div className="formula" dangerouslySetInnerHTML={{ __html: katex.renderToString(children, { displayMode: true, throwOnError: false }) }} />;
}

function Diagram() {
  return <div className="diagram-example">
    <svg viewBox="0 0 540 285" role="img" aria-label="Tank containing oil above water, with unknown pressure at the bottom">
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="205" y="20" width="116" height="245" rx="3"/>
        <path d="M205 108H321M205 180H321M170 46V241M166 234L170 242L174 234"/>
      </g>
      <g fill="currentColor" fontSize="12" fontFamily="system-ui, sans-serif" letterSpacing=".35">
        <text x="63" y="33">p_top = 1 bar abs</text>
        <text x="230" y="70">Oil: ρ = 850 kg/m³, h = 2 cm</text>
        <text x="248" y="141">Tank</text>
        <text x="226" y="158">Water: ρ = 1000 kg/m³, h = 4 cm</text>
        <text x="75" y="259">p_bottom = ?</text>
      </g>
    </svg>
    <Formula>{String.raw`\Delta p = \rho_{oil}gh_{oil} + \rho_{water}gh_{water}`}</Formula>
  </div>;
}

function Preview() {
  const [mode, setMode] = useState(1);
  const [fixture, setFixture] = useState('Diagram');
  const [speaking, setSpeaking] = useState(false);
  const [size, setSize] = useState({ width: 1320, height: 730 });
  const host = useRef(null), canvas = useRef(null), live = useRef({});
  const scene = stage(mode, fixture, size.width, size.height);
  live.current = { mode, speaking, scene, size };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: Math.max(720, entry.contentRect.height) }));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const atlas = stoneAtlas(tiles), context = canvas.current.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let animation;
    const draw = time => {
      const { scene: current, mode: currentMode, speaking: active, size: bounds } = live.current;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      if (canvas.current.width !== Math.round(bounds.width * ratio) || canvas.current.height !== Math.round(bounds.height * ratio)) {
        canvas.current.width = Math.round(bounds.width * ratio); canvas.current.height = Math.round(bounds.height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, bounds.width, bounds.height);
      current.targets.forEach((target, index) => {
        const tile = tiles[index], sprite = atlas.sprites[index];
        const distance = Math.hypot(target.x - current.presence.x, target.y - current.presence.y);
        const location = Math.exp(-((distance / 100) ** 2));
        const wave = active && !reduced.matches ? .5 + .5 * Math.sin(time / 380 - distance / 30) : .32;
        const base = .29 + tile.seed * .10;
        context.globalAlpha = currentMode === 0 && target.groupId === 'fold' ? .44 + tile.seed * .12 + wave * .09
          : base + (currentMode === 1 ? location * (.035 + wave * .07) : 0);
        const rotation = target.rotation;
        context.setTransform(Math.cos(rotation) * ratio, Math.sin(rotation) * ratio, -Math.sin(rotation) * ratio, Math.cos(rotation) * ratio, target.x * ratio, target.y * ratio);
        context.drawImage(atlas.canvas, sprite.sx, sprite.sy, atlas.cell, atlas.cell, -atlas.size / 2, -atlas.size / 2, atlas.size, atlas.size);
      });
      context.globalAlpha = 1;
      animation = requestAnimationFrame(draw);
    };
    animation = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animation);
  }, []);
  return <main>
    <header><a className="wordmark" href="/">luna<span> / presence studies</span></a><span className="study-note">Same 1,010 stones. Always full size.</span></header>
    <div className="controls">
      <div className="segmented" aria-label="Presence design">{modes.map((name, index) => <button key={name} aria-pressed={mode === index} onClick={() => setMode(index)}>{name}</button>)}</div>
      <div className="secondary-controls"><div className="segmented small" aria-label="Whiteboard example">{['Diagram', 'Equation'].map(name => <button key={name} aria-pressed={fixture === name} onClick={() => setFixture(name)}>{name}</button>)}</div><button className="voice-button" aria-pressed={speaking} onClick={() => setSpeaking(!speaking)}><span className={speaking ? 'status-dot active' : 'status-dot'} />{speaking ? 'Speaking' : 'Listening'}</button></div>
    </div>
    <div className="stage" ref={host} style={{ height: Math.max(730, scene.board.height + 140) }} data-mode={modes[mode]} data-tile-count={scene.targets.length} data-tile-scale="1">
      <canvas ref={canvas} aria-hidden="true"/>
      <section className="study-board" aria-label="Study whiteboard" style={{ left: scene.board.x + 45, top: scene.board.y + 46, width: scene.board.width - 90, height: scene.board.height - 92 }}>
        <button className="close-board" aria-label="Close preview whiteboard" onClick={() => setFixture(fixture === 'Diagram' ? 'Equation' : 'Diagram')}>×</button>
        {fixture === 'Diagram' ? <Diagram/> : <Formula>{'x^2 + y^2 = r^2'}</Formula>}
      </section>
      <p className="caption" style={{ top: scene.board.y + scene.board.height + 26, left: scene.board.x, width: scene.board.width }}>{fixture === 'Diagram' ? 'The pressure increases as we move toward the bottom.' : 'Every point on the circle is the same distance from its center.'}</p>
    </div>
    <footer><div><strong>{modes[mode]}</strong><p>{descriptions[mode]}</p></div><span>Interactive design preview</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<Preview/>);
