import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const outputDirectory = resolve(projectDirectory, 'public/course-mosaics');
const galleryURL = process.argv[2] || 'http://127.0.0.1:5188/course-mosaics';
const pngSize = 1800;
const collectionSize = { width: 1800, height: 1700 };

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, reducedMotion: 'reduce' });
  await page.goto(galleryURL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const manifest = await page.evaluate(async () => {
    const { COURSES } = await import('/src/course-mosaics/courses.mjs');
    const { SCIENCE_COURSES } = await import('/src/course-mosaics/sciences.mjs');
    const { ART_SIZE, createCourseTiles } = await import('/src/course-mosaics/renderer.mjs');
    return {
      schemaVersion: 2,
      title: 'Luna — A world in every stone.',
      description: 'Twelve subject-shaped mosaics made with Luna’s hand-cut tesserae, mineral pigments, and open negative space.',
      nativeCanvasSize: ART_SIZE,
      sources: {
        field: 'src/mosaic-field.mjs',
        renderer: 'src/course-mosaics/renderer.mjs',
        collection: 'src/course-mosaics/courses.mjs',
        exporter: 'scripts/export-course-mosaics.mjs',
      },
      courses: COURSES.map(({ id, name, category, subtitle, description, detail, palette, silhouette }) => ({
        id, name, category, subtitle, description, detail, palette,
        stoneCount: createCourseTiles(COURSES.find(course => course.id === id)).length,
        shape: 'subject-silhouette',
        source: SCIENCE_COURSES.some(course => course.id === id)
          ? 'src/course-mosaics/sciences.mjs'
          : 'src/course-mosaics/humanities.mjs',
        files: { png: `luna-${id}.png`, svg: `luna-${id}.svg` },
      })),
    };
  });

  if (manifest.courses.length !== 12) throw new Error(`Expected 12 course mosaics, found ${manifest.courses.length}.`);

  for (const course of manifest.courses) {
    const exported = await page.evaluate(async ({ id, pngSize }) => {
      const { COURSES } = await import('/src/course-mosaics/courses.mjs');
      const { ART_SIZE, createCourseTiles, drawCourse, courseSVG } = await import('/src/course-mosaics/renderer.mjs');
      const course = COURSES.find(course => course.id === id);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = pngSize;
      drawCourse(canvas.getContext('2d'), createCourseTiles(course), {
        size: ART_SIZE, ratio: pngSize / ART_SIZE, motion: false,
      });
      const context = canvas.getContext('2d');
      if (context.getImageData(0, 0, 1, 1).data[3] !== 0) throw new Error(`${id} lost its transparent background.`);
      const png = canvas.toDataURL('image/png').split(',')[1];
      return { png, svg: courseSVG(course) };
    }, { id: course.id, pngSize });

    await writeFile(resolve(outputDirectory, course.files.png), Buffer.from(exported.png, 'base64'));
    await writeFile(resolve(outputDirectory, course.files.svg), exported.svg, 'utf8');
    console.log(`Exported ${course.name}: ${course.files.png}, ${course.files.svg}`);
  }

  const collection = await page.evaluate(async ({ width, height }) => {
    const { COURSES } = await import('/src/course-mosaics/courses.mjs');
    const { ART_SIZE, createCourseTiles, drawCourse } = await import('/src/course-mosaics/renderer.mjs');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    const palette = { paper: '#faf9f6', ink: '#373a34', muted: '#7b8172', line: '#dfe2d8' };

    ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'alphabetic';

    const trackedText = (text, x, y, spacing) => {
      for (const character of text) {
        ctx.fillText(character, x, y);
        x += ctx.measureText(character).width + spacing;
      }
    };
    const rule = (y, from = 72, to = width - 72) => {
      ctx.strokeStyle = palette.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(from, y + .5); ctx.lineTo(to, y + .5); ctx.stroke();
    };

    ctx.fillStyle = palette.muted; ctx.font = '12px Arial, Helvetica, sans-serif';
    trackedText('LUNA / THE COURSE COLLECTION', 72, 57, 2.2);
    ctx.textAlign = 'right'; ctx.font = '14px Arial, Helvetica, sans-serif';
    ctx.fillText('TWELVE STUDIES IN STONE', width - 72, 57);
    ctx.textAlign = 'left'; ctx.fillStyle = palette.ink;
    ctx.font = '64px Georgia, "Times New Roman", serif';
    ctx.fillText('A world in every stone.', 69, 129);
    ctx.fillStyle = palette.muted; ctx.font = '17px Arial, Helvetica, sans-serif';
    ctx.fillText('Twelve fields of thought. Each in its own shape. Cut from Luna’s hand-crafted stone.', 72, 168);
    rule(194);

    const margin = 72, gap = 24, columns = 4;
    const cardWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
    const gridTop = 220, rowPitch = 458;
    const art = document.createElement('canvas');
    art.width = art.height = ART_SIZE * 3;

    COURSES.forEach((course, index) => {
      const x = margin + (index % columns) * (cardWidth + gap);
      const y = gridTop + Math.floor(index / columns) * rowPitch;
      drawCourse(art.getContext('2d'), createCourseTiles(course), {
        size: ART_SIZE, ratio: 3, motion: false, background: '#ffffff',
      });
      ctx.drawImage(art, x, y, cardWidth, cardWidth);

      ctx.fillStyle = '#969c8d'; ctx.font = '12px Arial, Helvetica, sans-serif';
      ctx.fillText(String(index + 1).padStart(2, '0'), x + 20, y + 30);

      ctx.fillStyle = palette.ink;
      let titleSize = 26;
      ctx.font = `${titleSize}px Georgia, "Times New Roman", serif`;
      while (ctx.measureText(course.name).width > cardWidth - 78 && titleSize > 19) {
        titleSize -= 1;
        ctx.font = `${titleSize}px Georgia, "Times New Roman", serif`;
      }
      ctx.fillText(course.name, x + 1, y + cardWidth + 31);

      ctx.fillStyle = palette.muted; ctx.font = '12px Arial, Helvetica, sans-serif';
      ctx.fillText(course.subtitle, x + 1, y + cardWidth + 52);

      Object.values(course.palette).forEach((color, pigmentIndex) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + cardWidth - 40 + pigmentIndex * 15, y + cardWidth + 23, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    rule(1630);
    ctx.fillStyle = palette.muted; ctx.font = '13px Arial, Helvetica, sans-serif';
    ctx.fillText('Distinct silhouettes. Imperfect edges. Small spaces for light.', 72, 1667);
    ctx.textAlign = 'right';
    ctx.fillText('Luna Study / Course studies / 2026', width - 72, 1667);
    return canvas.toDataURL('image/png').split(',')[1];
  }, collectionSize);

  await writeFile(resolve(outputDirectory, 'collection.png'), Buffer.from(collection, 'base64'));
  manifest.export = {
    png: { width: pngSize, height: pngSize, background: 'transparent', format: 'image/png' },
    svg: { width: 1440, height: 1440, background: 'transparent', format: 'image/svg+xml' },
    contactSheet: { file: 'collection.png', ...collectionSize, columns: 4, rows: 3, background: '#faf9f6' },
    gallery: '/course-mosaics',
  };
  await writeFile(resolve(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const files = [...manifest.courses.flatMap(course => Object.values(course.files)), 'collection.png', 'manifest.json'];
  const sizes = await Promise.all(files.map(async file => ({ file, bytes: (await stat(resolve(outputDirectory, file))).size })));
  if (sizes.some(file => file.bytes === 0)) throw new Error('An export was empty.');
  console.log(`Saved ${files.length} nonempty files to ${outputDirectory}`);
  console.log(`Contact sheet: ${resolve(outputDirectory, 'collection.png')}`);
} finally {
  await browser.close();
}
