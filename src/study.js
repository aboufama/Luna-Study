export const MAX_MATERIALS = 100;
export const MAX_TOTAL_CHARS = 500000;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const uid = () => crypto.randomUUID();

export function validateMaterials(materials) {
  if (!Array.isArray(materials) || !materials.length) throw Error('Add at least one readable source.');
  if (materials.length > MAX_MATERIALS) throw Error('This prototype supports up to 100 files per test.');
  const ids = new Set();
  let totalCharacters = 0;
  for (const material of materials) {
    if (!material.id || ids.has(material.id)) throw Error('Each source must have a unique ID.');
    if (!material.name || typeof material.text !== 'string' || !material.text.trim()) throw Error('This file contains no readable text.');
    ids.add(material.id);
    totalCharacters += material.text.length;
  }
  if (totalCharacters > MAX_TOTAL_CHARS) throw Error('This test exceeds 500,000 text characters. Split the material into another test.');
  return {sourceCount: materials.length,totalCharacters};
}

function excerpt(text, limit = 600) {
  const clean = text.replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const slice = clean.slice(0,limit);
  const boundary = Math.max(slice.lastIndexOf('. '),slice.lastIndexOf('? '),slice.lastIndexOf('! '));
  return `${slice.slice(0,boundary > limit/2 ? boundary+1 : slice.lastIndexOf(' '))}…`;
}

export function buildDemoGuide(materials, title) {
  const stats = validateMaterials(materials);
  const topics = materials.map(material => ({
    title: material.text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.slice(0,120) || material.name.replace(/\.[^.]+$/,'').replace(/[_-]/g,' '),
    summary: excerpt(material.text),
    sourceIds: [material.id],
  }));
  const questions = topics.map(topic => ({question:`What are the main ideas in “${topic.title}”? Explain them in your own words.`,answer:`Compare your explanation with this source excerpt: ${topic.summary}`,sourceIds:topic.sourceIds}));
  const opening = `Let's review ${title}. This local preview reads selected excerpts from your notes. `;
  let script = opening;
  for (const topic of topics) {
    const part = `${topic.title}. ${excerpt(topic.summary,350)} `;
    if (script.length + part.length > 2250) break;
    script += part;
  }
  script += ' Pause here and explain one idea in your own words. Open the source notes to check the details.';
  return {mode:'demo',...stats,overview:`Your ${materials.length} ${materials.length===1?'source is':'sources are'} organized below, with one excerpt and a recall prompt for each file. This preview helps you try the study flow; GPT-6 Luna can synthesize the material when connected.`,topics,questions,script};
}

const material = (id,name,text) => ({id,name,text,type:'md',size:new TextEncoder().encode(text).length});
export const demoTests = [
  {id:'sample-biology',title:'Cell biology midterm',subject:'BIOLOGY 101',date:'2026-10-08',guide:null,reviewed:[],materials:[
    material('bio-membranes','Lecture 04 · Cell membranes.md','# Cell membranes\n\nThe cell membrane is a selectively permeable phospholipid bilayer. Hydrophilic heads face the surrounding water, and hydrophobic tails face inward. Membrane proteins help transport substances and communicate with other cells.\n\n# Passive and active transport\n\nDiffusion moves particles from higher to lower concentration. Osmosis is the net movement of water across a selectively permeable membrane. Active transport uses energy to move substances against a concentration gradient.'),
    material('bio-energy','Chapter 06 · Cellular energy.md','# Cellular energy\n\nATP transfers energy for cellular work. Cellular respiration transfers energy from nutrients into ATP. In eukaryotic cells, glycolysis takes place in the cytosol, while the citric acid cycle and oxidative phosphorylation involve mitochondria.\n\n# Enzymes\n\nEnzymes speed up reactions by lowering activation energy. They do not change the overall free-energy change of a reaction. Temperature and pH can affect enzyme function.'),
    material('bio-division','Revision notes · Cell division.md','# Cell division\n\nThe cell cycle includes interphase and the mitotic phase. DNA is replicated during S phase of interphase. Mitosis separates duplicated chromosomes into two nuclei; cytokinesis divides the cytoplasm.\n\n# Mitosis and meiosis\n\nMitosis usually produces two genetically similar daughter cells. Meiosis reduces chromosome number and produces genetically varied cells through crossing over and independent assortment.')
  ]},
  {id:'sample-calculus',title:'Calculus I quiz',subject:'MATH 1110',date:'2026-10-12',materials:[],guide:null,reviewed:[]}
];
