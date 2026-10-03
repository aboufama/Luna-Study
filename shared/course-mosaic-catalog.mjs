// Subject identities shared by the classifier and the artwork. No renderer or
// uploaded study material belongs in this catalogue.
export const COURSE_MOSAIC_VERSION = 2;
export const COURSE_MOSAIC_CATALOG = Object.freeze([
  { id: 'mathematics', name: 'Mathematics', description: 'Mathematics, algebra, calculus, geometry, statistics, probability, and mathematical reasoning.' },
  { id: 'physics', name: 'Physics', description: 'Physics, mechanics, forces, energy, electricity, magnetism, thermodynamics, and physical engineering principles.' },
  { id: 'chemistry', name: 'Chemistry', description: 'Chemistry, atoms, molecules, chemical bonds, reactions, organic chemistry, and chemical materials.' },
  { id: 'biology', name: 'Biology', description: 'Biology, cells, genetics, anatomy, physiology, medicine, and the structure and function of living organisms.' },
  { id: 'computer-science', name: 'Computer science', description: 'Computer science, programming, algorithms, data structures, software, computer systems, and artificial intelligence.' },
  { id: 'astronomy', name: 'Astronomy', description: 'Astronomy, astrophysics, planets, stars, galaxies, cosmology, and space science.' },
  { id: 'economics', name: 'Economics', description: 'Economics, markets, finance, business, accounting, strategic decision-making, and game theory.' },
  { id: 'world-history', name: 'World History', description: 'History, civilizations, archaeology, historical political events, and the development of societies across time.' },
  { id: 'literature', name: 'Literature', description: 'Literature, reading, writing, languages, rhetoric, literary analysis, philosophy, and textual interpretation.' },
  { id: 'psychology', name: 'Psychology', description: 'Psychology, cognition, perception, memory, human behavior, mental processes, and related social or behavioral sciences.' },
  { id: 'music-theory', name: 'Music Theory', description: 'Music, harmony, rhythm, composition, musical analysis, performance, and closely related creative arts.' },
  { id: 'environmental-science', name: 'Environmental Science', description: 'Environmental science, ecology, climate, conservation, earth science, geology, geography, and ecosystems.' },
].map(course => Object.freeze(course)));

export const COURSE_MOSAIC_IDS = Object.freeze(COURSE_MOSAIC_CATALOG.map(course => course.id));
export const normalizeCourseTitle = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
