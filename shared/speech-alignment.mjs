// Eleven dialogue uses snake_case; legacy TTS uses camelCase. Both describe
// timings on the associated audio chunk. Unknown/out-of-chunk data is ignored.
export function normalizeSpeechAlignment(value, durationMs) {
  if (!value || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const chars=value.chars, starts=value.char_start_times_ms??value.charStartTimesMs??value.startsMs;
  const durations=value.char_durations_ms??value.charDurationsMs??value.durationsMs;
  if (!Array.isArray(chars)||!chars.length||chars.length>4096||!Array.isArray(starts)||!Array.isArray(durations)||starts.length!==chars.length||durations.length!==chars.length) return null;
  let previous=-1;
  for(let i=0;i<chars.length;i++){
    if(typeof chars[i]!=='string'||!chars[i].length||chars[i].length>16||!Number.isFinite(starts[i])||!Number.isFinite(durations[i])||starts[i]<previous||starts[i]<0||durations[i]<0||starts[i]+durations[i]>durationMs+35)return null;
    previous=starts[i];
  }
  if(chars.join('').length>4096)return null;
  return {chars:[...chars],startsMs:[...starts],durationsMs:[...durations]};
}
