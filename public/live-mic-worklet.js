// Resample microphone frames to continuous 16 kHz mono PCM16. GPT-Live uses
// 20 ms packets; the original ElevenLabs path retains its 100 ms packets.
class LunaMicProcessor extends AudioWorkletProcessor {
  constructor(options){super();this.phase=0;this.sum=0;this.count=0;this.index=0;this.power=0;this.chunkSamples=options?.processorOptions?.chunkSamples===320?320:1600;this.samples=new Int16Array(this.chunkSamples);}
  process(inputs){
    const channel=inputs[0]?.[0];if(!channel)return true;
    for(const value of channel){
      this.sum+=value;this.count++;this.phase+=16000;
      if(this.phase>=sampleRate){
        this.phase-=sampleRate;
        const sample=Math.max(-1,Math.min(1,this.sum/this.count));this.sum=0;this.count=0;
        this.samples[this.index++]=sample<0?sample*32768:sample*32767;this.power+=sample*sample;
        if(this.index===this.samples.length){
          const audio=this.samples.buffer;this.port.postMessage({audio,rms:Math.sqrt(this.power/this.index)},[audio]);
          this.samples=new Int16Array(this.chunkSamples);this.index=0;this.power=0;
        }
      }
    }
    return true;
  }
}
registerProcessor('luna-mic',LunaMicProcessor);
