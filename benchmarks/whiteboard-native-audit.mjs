// Offline semantic edit audit. IDs are opaque; identify the moved vendor from
// its visible label and nearest native marker rather than an ID naming rule.
export function auditCityEdit(before, after, vendor = 'A') {
  const label = before.find(el => el.type === 'text' && new RegExp(`\\b${vendor}\\b`).test(el.text));
  const marker = label && before.filter(el => el.type === 'ellipse').sort((a, b) => Math.hypot(a.x-label.x,a.y-label.y)-Math.hypot(b.x-label.x,b.y-label.y))[0];
  const movedIds = label && marker ? [label.id, marker.id] : [];
  const keys = ['x','y','width','height','text'];
  const differences = before.flatMap(old => {
    const next = after.find(el => el.id === old.id);
    return next ? keys.filter(key => old[key] !== next[key]).map(key => ({id:old.id,key,before:old[key],after:next[key]})) : [{id:old.id,key:'removed'}];
  });
  const idsPreserved = before.length === after.length && before.every(old => after.some(next => next.id === old.id));
  return {pass:movedIds.length === 2 && idsPreserved && differences.every(diff => movedIds.includes(diff.id)),movedIds,idsPreserved,differences};
}
