import { MAX_TOTAL_CHARS } from './study.js';

export async function extractPdfText(pdf) {
  if (pdf.numPages > 250) throw Error('This PDF exceeds the 250-page prototype limit. Split it into smaller files.');
  const pages = [], pagesWithoutText = [];
  let characters = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    try {
      const content = await page.getTextContent();
      const text = content.items.map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('').replace(/\u0000/g, '').trim();
      characters += text.length;
      if (characters > MAX_TOTAL_CHARS) throw Error('This file exceeds 500,000 extracted text characters.');
      if (!text) pagesWithoutText.push(number);
      pages.push(text);
    } finally { page.cleanup(); }
  }
  return { text: pages.join('\n\n'), extraction: { pageCount: pdf.numPages, pagesWithoutText } };
}

export function pdfExtractionWarning(material) {
  if (material.type !== 'pdf') return '';
  const missing = material.extraction?.pagesWithoutText?.length || 0;
  return missing
    ? `${missing} of ${material.extraction.pageCount} pages had no readable text. Images and scans are not included.`
    : 'Text only: images, diagrams, and scanned content are not included.';
}
