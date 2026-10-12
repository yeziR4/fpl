import json,wave,numpy as np
SR=44100; cues=json.load(open('cues.json'))
def rd(f):
    w=wave.open(f); sr=w.getframerate(); ch=w.getnchannels(); x=np.frombuffer(w.readframes(w.getnframes()),'<i2').astype(float)/32768; w.close()
    if ch==2: x=x.reshape(-1,2)
    return x,sr
mus,_=rd('music.wav'); N=len(mus); vo=np.zeros(N)
for c in cues['cues']:
    x,sr=rd(f"vo3/{c['id']}.wav")
    t=np.arange(int(len(x)*SR/sr))/SR; y=np.interp(t,np.arange(len(x))/sr,x)
    i=int(c['start']*SR); j=min(N,i+len(y)); vo[i:j]+=y[:j-i]
vo=vo/np.max(np.abs(vo))*0.92
# light presence boost: simple high-shelf via difference
mix=mus*0.30+vo[:,None]
mix/=max(1,np.max(np.abs(mix))/0.98)
for name,arr in (('mix.wav',mix),('music_only.wav',mus*0.6)):
    w=wave.open(name,'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((arr*32767).astype('<i2').tobytes()); w.close()
print('ok')
