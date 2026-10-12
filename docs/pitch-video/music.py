import numpy as np,json,wave
SR=44100; c=json.load(open('cues.json')); T=c['total']; N=int(T*SR); out=np.zeros(N)
def lp(x,cut):
    X=np.fft.rfft(x); f=np.fft.rfftfreq(len(x),1/SR); X/=1+(f/cut)**4; return np.fft.irfft(X,len(x))
note=lambda m:440*2**((m-69)/12)
prog=[[57,60,64,71],[53,57,60,67],[48,52,55,62],[55,59,62,69]]  # Am9 F C G add9 voicings
bar=60/84*4; t=0; k=0
while t<T:
    d=min(bar+1.0,T-t); tt=np.arange(int(d*SR))/SR; s=np.zeros(len(tt))
    for m in prog[k%4]:
        for det in (-.003,.003): s+=np.sin(2*np.pi*note(m)*(1+det)*tt)+.3*np.sin(4*np.pi*note(m)*(1+det)*tt)
    env=np.minimum(1,tt/0.8)*np.minimum(1,(d-tt)/0.8); s=s*env/8
    # soft pluck arpeggio
    for q in range(8):
        m=prog[k%4][q%4]+12; st=int(q*bar/8*SR)
        if st<len(tt):
            pt=tt[:len(tt)-st]; s[st:]+=0.12*np.sin(2*np.pi*note(m)*pt)*np.exp(-pt*5)
    # bass
    s+=0.35*np.sin(2*np.pi*note(prog[k%4][0]-12)*tt)*env
    i=int(t*SR); out[i:i+len(s)]+=s[:N-i]; t+=bar; k+=1
out=lp(out,3500)
duck=np.ones(N)
for q in c['cues']: duck[int((q['start']-.1)*SR):int((q['start']+q['dur']+.1)*SR)]=0.55
kk=int(.2*SR); duck=np.convolve(duck,np.ones(kk)/kk,'same'); out*=duck
out/=np.abs(out).max(); out*=0.22
f=int(2*SR); out[:f]*=np.linspace(0,1,f); out[-f:]*=np.linspace(1,0,f)
vo=np.zeros(N)
for q in c['cues']:
    w=wave.open(f"vo/{q['id']}.wav"); sr=w.getframerate(); x=np.frombuffer(w.readframes(w.getnframes()),'<i2').astype(float)/32768
    if w.getnchannels()==2: x=x.reshape(-1,2).mean(1)
    w.close(); y=np.interp(np.arange(int(len(x)*SR/sr))/SR,np.arange(len(x))/sr,x); i=int(q['start']*SR); vo[i:i+len(y)]+=y[:N-i]
vo/=np.abs(vo).max(); mix=vo*0.9+out; mix/=max(1,np.abs(mix).max()/0.97)
w=wave.open('mix.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix*32767).astype('<i2').tobytes()); w.close(); print('ok')
