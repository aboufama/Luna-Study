import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { prettyDate } from '../CreateTest.jsx';
import CourseCanvas from './CourseCanvas.jsx';
import { COURSES } from './courses.mjs';
import { selectedCourseId } from './assignment.mjs';
import './test-cards.css';

const courses = new Map(COURSES.map(course => [course.id, course]));
const neutral = {
  id: 'unassigned', name: 'Luna', description: 'A small stack of study pages in quiet mineral stone.',
  palette: { ink: '#97988e', accent: '#b9baaf', stone: '#d8d9d1' },
  silhouette: [
    { fill: true, points: [{ x: -62, y: -88 }, { x: 60, y: -88 }, { x: 60, y: 64 }, { x: -62, y: 64 }] },
    { fill: true, points: [{ x: -74, y: -65 }, { x: 44, y: -76 }, { x: 59, y: 78 }, { x: -58, y: 89 }] },
    { fill: true, points: [{ x: -40, y: -70 }, { x: 79, y: -53 }, { x: 58, y: 99 }, { x: -62, y: 82 }] },
  ],
  motifs: [
    { points: [{ x: -40, y: -70 }, { x: -62, y: 82 }, { x: 58, y: 99 }], width: 7, strength: .5, layer: 'accent' },
    { points: [{ x: -18, y: -29 }, { x: 45, y: -20 }], width: 6, strength: .5, layer: 'ink' },
    { points: [{ x: -21, y: -9 }, { x: 42, y: 0 }], width: 6, strength: .4, layer: 'ink' },
    { points: [{ x: -24, y: 11 }, { x: 23, y: 18 }], width: 6, strength: .35, layer: 'ink' },
  ],
};
const kind = value => ({ quiz: 'Quiz', test: 'Test', final: 'Final' }[value] || 'Test');

function MaterialPreviews({ materials }) {
  const shown = materials.slice(0, 3);
  return <span className="course-card-documents" role="img" aria-label={`${materials.length} imported ${materials.length === 1 ? 'document' : 'documents'}: ${shown.map(material => material.name).join(', ')}`}>
    {shown.map((material, index) => {
      const name = typeof material.name === 'string' ? material.name : 'Imported document';
      const type = (typeof material.type === 'string' ? material.type : name.split('.').at(-1) || '').slice(0, 5).toUpperCase();
      const excerpt = typeof material.text === 'string' ? material.text.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      return <span className="course-card-paper" key={material.id || `${name}-${index}`} title={name} style={{ '--paper-index': index, '--paper-count': shown.length }} aria-hidden="true">
        <span className="course-card-paper-title">{name}</span>
        <span className="course-card-paper-copy">{excerpt}</span>
        <span className="course-card-paper-type">{type}</span>
      </span>;
    })}
  </span>;
}

function CourseProgress({ progress }) {
  const circumference = 2 * Math.PI * 10;
  return <span className="course-card-progress" role="progressbar" aria-label="Mastery of indexed topics" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} title={`${progress}% mastery of indexed topics`}>
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="10" className="course-card-progress-track" /><circle cx="13" cy="13" r="10" className="course-card-progress-value" strokeDasharray={`${circumference * progress / 100} ${circumference}`} transform="rotate(-90 13 13)" /></svg>
    <span>{progress}%</span>
  </span>;
}

export default function TestCard({ test, onOpen }) {
  const courseId = selectedCourseId(test), course = courses.get(courseId) || neutral;
  const materials = Array.isArray(test.materials) ? test.materials.filter(material => material && typeof material === 'object') : [];
  const measured = test.mastery?.overall;
  // Imports reset mastery to zero with no topics. Show only the current public
  // server score once actual indexed topics exist, never invented progress.
  const progress = materials.length && Array.isArray(test.mastery?.topics) && test.mastery.topics.length
    && typeof measured === 'number' && Number.isFinite(measured) && measured >= 0 && measured <= 100 ? Math.round(measured) : null;
  return <button className="test-tile course-test-tile" onClick={() => onOpen(test)} data-course-id={courseId || 'unassigned'}>
    <span className="course-card-art" aria-hidden="true">
      <span className="tile-kind">{kind(test.difficulty)}</span>
      <span className="course-card-arrow"><ArrowUpRight size={16} strokeWidth={1.4} /></span>
      <CourseCanvas course={course} className="course-card-canvas" decorative />
    </span>
    <span className="course-card-body"><span className="course-card-copy"><span className="course-card-title"><h2>{test.className || test.title}</h2></span>
      <span className="tile-bottom">{test.date ? prettyDate(test.date) : 'Date to be decided'}</span></span>
      {(materials.length > 0 || progress !== null) && <span className="course-card-study-state">
        {materials.length > 0 && <MaterialPreviews materials={materials} />}
        {progress !== null && <CourseProgress progress={progress} />}
      </span>}
    </span>
  </button>;
}
