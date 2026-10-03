import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, CircleSlash2, GraduationCap, X } from 'lucide-react';
import './teacher-skins.css';

const STORAGE_KEY = 'luna-teacher-hat-v1';
const HATS = [
  { id: 'none', label: 'None' },
  { id: 'beret', label: 'Beret', crop: [59, 181, 614, 387], width: 174, x: -7, bottom: 112, tilt: -7 },
  { id: 'academic', label: 'Scholar', crop: [742, 170, 689, 409], width: 196, x: 4, bottom: 104, tilt: 0 },
  { id: 'wizard', label: 'Wizard', crop: [1472, 70, 653, 529], width: 166, x: 5, bottom: 111, tilt: 3 },
];
const validHat = value => HATS.some(hat => hat.id === value) ? value : 'none';

function savedHat() {
  try { return validHat(localStorage.getItem(STORAGE_KEY)); }
  catch { return 'none'; }
}

function HatArt({ hat, ...props }) {
  return <svg {...props} viewBox={hat.crop.join(' ')} width={hat.crop[2]} height={hat.crop[3]} aria-hidden="true" focusable="false">
    <image href="/skins/hats.png" width="2172" height="724" />
  </svg>;
}

// Mount directly inside the positioned study screen, alongside VoiceCanvas.
// The art is decorative and never receives a pointer or starts a voice session.
export default function TeacherSkins({ orbRef, boardOpen = false, activeTestId }) {
  const [selected, setSelected] = useState(savedHat);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(null);
  const rootRef = useRef(null), menuRef = useRef(null), triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const panelId = useId(), labelId = useId();
  const hat = HATS.find(item => item.id === selected) || HATS[0];

  useEffect(() => {
    function sync(event) {
      if (event.key === STORAGE_KEY || event.key === null) setSelected(savedHat());
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  useEffect(() => { setOpen(false); }, [activeTestId, boardOpen]);

  // Wait until sibling refs are attached before measuring the orb.
  useEffect(() => {
    const root = rootRef.current, orb = orbRef?.current;
    if (!root || !orb || boardOpen) return;
    let frame;
    function measure() {
      const bounds = root.getBoundingClientRect(), body = orb.getBoundingClientRect();
      const unit = 1;
      setAnchor({ x: body.left + body.width / 2 - bounds.left, y: body.top + body.height / 2 - bounds.top - 5 * unit, unit });
    }
    function resize() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
    measure();
    const observer = new ResizeObserver(resize);
    observer.observe(root); observer.observe(orb);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(frame); };
  }, [orbRef, activeTestId, boardOpen]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => optionRefs.current[HATS.findIndex(item => item.id === selected)]?.focus());
    function outside(event) { if (!menuRef.current?.contains(event.target)) setOpen(false); }
    function escape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault(); setOpen(false); triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, selected]);

  function choose(id) {
    setSelected(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Still works for this visit when storage is unavailable. */ }
    setOpen(false); triggerRef.current?.focus();
  }

  function navigate(event, index) {
    const directions = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = HATS.length - 1;
    else if (directions[event.key]) next = (index + directions[event.key] + HATS.length) % HATS.length;
    else return;
    event.preventDefault(); optionRefs.current[next]?.focus();
  }

  return <div ref={rootRef} className="teacher-skins" data-board-open={boardOpen || undefined}>
    {!boardOpen && hat.crop && anchor && <HatArt
      key={hat.id}
      hat={hat}
      className="teacher-hat"
      style={{ left: anchor.x + hat.x * anchor.unit, top: anchor.y - hat.bottom * anchor.unit, width: hat.width * anchor.unit, '--hat-tilt': `${hat.tilt}deg` }}
    />}
    {!boardOpen && <div ref={menuRef} className="teacher-skins-menu" onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button ref={triggerRef} type="button" className="teacher-skins-trigger" aria-label={`Teacher hats. Current: ${hat.label}`} title="Teacher hats" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}>
        <GraduationCap size={18} strokeWidth={1.5} aria-hidden="true" />
        {selected !== 'none' && <span className="teacher-skins-equipped" aria-hidden="true" />}
      </button>
      {open && <div id={panelId} className="teacher-skins-popover" role="dialog" aria-labelledby={labelId}>
        <div className="teacher-skins-heading">
          <span id={labelId}>Teacher hats</span>
          <button type="button" className="teacher-skins-close" aria-label="Close hats" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={14} strokeWidth={1.5} aria-hidden="true" /></button>
        </div>
        <div className="teacher-skins-options">
          {HATS.map((item, index) => <button key={item.id} ref={node => { optionRefs.current[index] = node; }} type="button" className={`teacher-skins-option${selected === item.id ? ' is-selected' : ''}`} aria-label={item.id === 'none' ? 'No hat' : item.label} aria-pressed={selected === item.id} onClick={() => choose(item.id)} onKeyDown={event => navigate(event, index)}>
            <span className="teacher-skins-preview">{item.crop ? <HatArt hat={item} className="teacher-skins-art" /> : <CircleSlash2 size={21} strokeWidth={1} aria-hidden="true" />}</span>
            <span className="teacher-skins-name">{item.label}</span>
            {selected === item.id && <Check className="teacher-skins-check" size={10} strokeWidth={2} aria-hidden="true" />}
          </button>)}
        </div>
      </div>}
    </div>}
  </div>;
}
