import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Download, Pause, Play, X } from 'lucide-react';
import { COURSES } from './courses.mjs';
import { ART_SIZE, createCourseTiles, drawCourse, courseSVG } from './renderer.mjs';
import CourseCanvas, { useReducedMotion } from './CourseCanvas.jsx';
import './gallery.css';

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function downloadSVG(course, monochrome) {
  saveBlob(new Blob([courseSVG(course, monochrome)], { type: 'image/svg+xml' }), `luna-${course.id}${monochrome ? '-graphite' : ''}.svg`);
}

function downloadPNG(course, monochrome) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1800;
  drawCourse(canvas.getContext('2d'), createCourseTiles(course, monochrome), { size: ART_SIZE, ratio: 5 });
  canvas.toBlob(blob => { if (blob) saveBlob(blob, `luna-${course.id}${monochrome ? '-graphite' : ''}.png`); }, 'image/png');
}

function Pigments({ course, monochrome }) {
  const colors = monochrome ? ['#484740', '#787469', '#bdbcb5'] : Object.values(course.palette);
  return <span className="cm-pigments" aria-hidden="true">{colors.map((color, i) => <i key={i} style={{ backgroundColor: color }} />)}</span>;
}

function Detail({ index, onChange, onClose, monochrome, moving }) {
  const ref = useRef(null), course = COURSES[index];
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; dialog.close(); };
  }, []);
  const turn = direction => onChange((index + direction + COURSES.length) % COURSES.length);
  return <dialog ref={ref} className="cm-detail" aria-labelledby="cm-detail-title" onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => { if (event.key === 'ArrowRight') turn(1); if (event.key === 'ArrowLeft') turn(-1); }}>
    <div className="cm-detail-inner">
      <div className="cm-detail-top"><span className="cm-eyebrow">STUDY {String(index + 1).padStart(2, '0')} / 12</span><button className="cm-icon" autoFocus aria-label="Close detail" onClick={onClose}><X size={20} /></button></div>
      <div className="cm-detail-art"><CourseCanvas course={course} monochrome={monochrome} moving={moving} enlarged /></div>
      <div className="cm-detail-copy"><div><span className="cm-eyebrow">{course.category}</span><h2 id="cm-detail-title">{course.name}</h2></div><Pigments course={course} monochrome={monochrome} /></div>
      <p className="cm-detail-description">{course.description}</p>
      <p className="cm-detail-note">{course.detail}</p>
      <div className="cm-detail-actions"><button className="cm-download" onClick={() => downloadPNG(course, monochrome)}><Download size={15} /> Save PNG</button><button className="cm-download" onClick={() => downloadSVG(course, monochrome)}>Save SVG <ArrowUpRight size={14} /></button><div className="cm-step"><button className="cm-icon" aria-label="Previous course" onClick={() => turn(-1)}><ChevronLeft size={20} /></button><button className="cm-icon" aria-label="Next course" onClick={() => turn(1)}><ChevronRight size={20} /></button></div></div>
    </div>
  </dialog>;
}

export default function Gallery() {
  const [monochrome, setMonochrome] = useState(false), [moving, setMoving] = useState(true), [selected, setSelected] = useState(null);
  const reduced = useReducedMotion();
  useEffect(() => { const previous = document.title; document.title = 'Course mosaics — Luna'; return () => { document.title = previous; }; }, []);
  return <div className="cm-page">
    <header className="cm-nav"><a href="/" className="cm-back"><ArrowLeft size={15} /><span>Luna Study</span></a><span className="cm-nav-caption">THE COURSE COLLECTION</span><span className="cm-edition">№ 001–012</span></header>
    <main className="cm-main">
      <section className="cm-intro"><div><span className="cm-eyebrow">TWELVE STUDIES IN STONE</span><h1>A world in<br /><em>every stone.</em></h1></div><div className="cm-intro-note"><span className="cm-small-mark" aria-hidden="true">✳</span><p>Each subject, in its own shape.<br />Twelve course mosaics in mineral color,<br className="cm-desktop-break" /> with the smallest of movements.</p><span className="cm-intro-caption">Luna’s hand-cut stone, reimagined.</span></div></section>
      <div className="cm-toolbar"><span className="cm-count">The collection <span>12</span></span><div className="cm-controls"><div className="cm-segment" role="group" aria-label="Mosaic palette"><button aria-pressed={!monochrome} onClick={() => setMonochrome(false)}>Mineral color</button><button aria-pressed={monochrome} onClick={() => setMonochrome(true)}>Graphite</button></div><button className="cm-motion" disabled={reduced} aria-pressed={moving && !reduced} onClick={() => setMoving(!moving)} aria-label={reduced ? 'Motion disabled by reduced-motion preference' : moving ? 'Pause mosaic movement' : 'Play mosaic movement'}>{moving && !reduced ? <Pause size={13} /> : <Play size={13} />}<span>{reduced ? 'Reduced motion' : moving ? 'In motion' : 'At rest'}</span></button></div></div>
      <div className="cm-grid">{COURSES.map((course, index) => <article className="cm-card" key={course.id}>
        <button className="cm-art-button" aria-label={`Explore ${course.name} mosaic`} onClick={() => setSelected(index)}>
          <span className="cm-card-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="cm-expand" aria-hidden="true"><ArrowUpRight size={17} /></span>
          <CourseCanvas course={course} monochrome={monochrome} moving={moving && selected === null} />
        </button>
        <div className="cm-card-info"><div><h2><button onClick={() => setSelected(index)}>{course.name}</button></h2><p>{course.subtitle}</p></div><Pigments course={course} monochrome={monochrome} /></div>
      </article>)}</div>
      <section className="cm-colophon"><div><span className="cm-eyebrow">ONE VISUAL LANGUAGE</span><h2>Cut from the same stone.</h2></div><p>Imperfect edges. Small spaces for light.<br />Open pages, branching ideas, a living helix.<br className="cm-desktop-break" /> Each silhouette tells its own story.</p><span className="cm-colophon-number" aria-hidden="true">12</span></section>
    </main>
    <footer className="cm-footer"><span>Luna / Course studies</span><span>Made for a quiet place to think.</span><span>2026</span></footer>
    {selected !== null && <Detail index={selected} onChange={setSelected} onClose={() => setSelected(null)} monochrome={monochrome} moving={moving} />}
  </div>;
}
